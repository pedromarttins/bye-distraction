const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const dgram = require('dgram')
const { execSync, spawn } = require('child_process')
const dns = require('dns').promises

app.setAppUserModelId('bye-distraction')

// ── Admin helpers ─────────────────────────────────────────────────────────────

function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function relaunchAsAdmin() {
  isRelaunchingAsAdmin = true
  app.releaseSingleInstanceLock()

  const execPath = process.execPath
  const appPath = __dirname
  const vbs = `Set sh = CreateObject("Shell.Application")\r\n` +
              `sh.ShellExecute "${execPath}", Chr(34) & "${appPath}" & Chr(34), "", "runas", 1\r\n`
  const vbsPath = path.join(os.tmpdir(), 'bye-distraction-admin.vbs')
  fs.writeFileSync(vbsPath, vbs)
  spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 200)
}

// ── Data ──────────────────────────────────────────────────────────────────────

const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts'
const MARKER_START = '# BYE-DISTRACTION START'
const MARKER_END = '# BYE-DISTRACTION END'

let dataFile
let sites = []
let isBlocking = false
let persistBlockingOnQuit = false
let mainWindow = null
let tray = null
let isQuitting = false
let isRelaunchingAsAdmin = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function getDataFile() {
  return path.join(app.getPath('userData'), 'sites.json')
}

function loadData() {
  dataFile = getDataFile()
  if (fs.existsSync(dataFile)) {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'))
    sites = data.sites || []
    isBlocking = data.isBlocking || false
    persistBlockingOnQuit = data.persistBlockingOnQuit || false
  }
}

function saveData() {
  if (!dataFile) dataFile = getDataFile()
  fs.writeFileSync(dataFile, JSON.stringify({ sites, isBlocking, persistBlockingOnQuit }, null, 2))
}

function getState() {
  return { sites, isBlocking, persistBlockingOnQuit }
}

function normalizeSite(site) {
  return site.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

async function reapplyBlockingIfNeeded() {
  if (isBlocking) await applyBlocking()
}

// ── Hosts file ────────────────────────────────────────────────────────────────

const COMMON_SUBDOMAINS = ['www', 'api', 'm', 'mobile', 'app', 'static', 'cdn',
  'media', 'img', 'assets', 'video', 'upload', 'abs', 'pbs']

function getSiteTargets(site) {
  return [site, ...COMMON_SUBDOMAINS.map(sub => `${sub}.${site}`)]
}

function applyHostsFile() {
  let content = fs.readFileSync(HOSTS_FILE, 'utf-8')
  const startIdx = content.indexOf(MARKER_START)
  const endIdx = content.indexOf(MARKER_END)
  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + content.slice(endIdx + MARKER_END.length + 1)
    content = content.replace(/\n+$/, '\n')
  }
  if (isBlocking && sites.length > 0) {
    const lines = sites.flatMap(site =>
      getSiteTargets(site).map(target => `0.0.0.0 ${target}`)
    )
    content += `\n${MARKER_START}\n${lines.join('\n')}\n${MARKER_END}\n`
  }
  fs.writeFileSync(HOSTS_FILE, content, 'utf-8')
}

function removeHostsBlock() {
  let content = fs.readFileSync(HOSTS_FILE, 'utf-8')
  const startIdx = content.indexOf(MARKER_START)
  const endIdx = content.indexOf(MARKER_END)
  if (startIdx === -1 || endIdx === -1) return

  content = content.slice(0, startIdx) + content.slice(endIdx + MARKER_END.length + 1)
  content = content.replace(/\n+$/, '\n')
  fs.writeFileSync(HOSTS_FILE, content, 'utf-8')
}

// ── Browser cache clearing ────────────────────────────────────────────────────

function clearBrowserCaches() {
  const local = process.env.LOCALAPPDATA
  const roaming = process.env.APPDATA

  const chromiumBases = [
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Microsoft', 'Edge', 'User Data'),
    path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    path.join(local, 'Chromium', 'User Data'),
  ]

  const subDirs = ['Cache', 'Code Cache',
    path.join('Service Worker', 'CacheStorage'),
    path.join('Service Worker', 'ScriptCache')]

  for (const base of chromiumBases) {
    if (!fs.existsSync(base)) continue
    const profiles = fs.readdirSync(base)
      .filter(d => d === 'Default' || /^Profile \d+$/.test(d))
    for (const profile of profiles) {
      for (const sub of subDirs) {
        const target = path.join(base, profile, sub)
        try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
      }
    }
  }

  // Firefox — profiles have random hash suffixes
  const ffBase = path.join(roaming, 'Mozilla', 'Firefox', 'Profiles')
  if (fs.existsSync(ffBase)) {
    for (const profile of fs.readdirSync(ffBase)) {
      const target = path.join(ffBase, profile, 'cache2')
      try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
    }
  }
}

// ── DoH blocking ─────────────────────────────────────────────────────────────
// Browsers use DNS-over-HTTPS bypassing the local UDP proxy entirely.
// We block HTTPS (TCP+UDP 443) to known DoH server IPs so browsers fall back to system DNS.

const DOH_IPS = [
  '8.8.8.8', '8.8.4.4',           // Google
  '1.1.1.1', '1.0.0.1',           // Cloudflare
  '9.9.9.9', '149.112.112.112',   // Quad9
  '208.67.222.222', '208.67.220.220' // OpenDNS
]

const DOH_DOMAINS = [
  'dns.google', 'cloudflare-dns.com', 'mozilla.cloudflare-dns.com',
  'doh.opendns.com', 'dns.quad9.net', 'dns.nextdns.io', 'doh.cleanbrowsing.org'
]

function applyDohBlock() {
  removeDohBlock()
  if (!isBlocking) return
  const ips = DOH_IPS.join(',')
  execSync(`netsh advfirewall firewall add rule name="BYE-DISTRACTION-DOH" dir=out action=block protocol=TCP remoteip="${ips}" remoteport=443 enable=yes`, { stdio: 'ignore' })
  execSync(`netsh advfirewall firewall add rule name="BYE-DISTRACTION-DOH" dir=out action=block protocol=UDP remoteip="${ips}" remoteport=443 enable=yes`, { stdio: 'ignore' })
}

function removeDohBlock() {
  try {
    execSync('netsh advfirewall firewall delete rule name="BYE-DISTRACTION-DOH"', { stdio: 'ignore' })
  } catch {}
}

// ── DNS proxy ─────────────────────────────────────────────────────────────────

const UPSTREAM_DNS = '8.8.8.8'
let dnsServer = null

function parseDomainFromQuery(buf) {
  let pos = 12
  const parts = []
  while (pos < buf.length) {
    const len = buf[pos]
    if (len === 0 || (len & 0xC0) === 0xC0) break
    pos++
    parts.push(buf.slice(pos, pos + len).toString('ascii'))
    pos += len
  }
  return parts.join('.').toLowerCase()
}

function buildBlockedResponse(query) {
  let pos = 12
  while (pos < query.length && query[pos] !== 0) pos += query[pos] + 1
  pos += 5 // null + QTYPE(2) + QCLASS(2)
  const resp = Buffer.alloc(pos + 16)
  query.copy(resp, 0, 0, pos)
  resp[2] = 0x81; resp[3] = 0x80          // response flags
  resp[6] = 0x00; resp[7] = 0x01          // ANCOUNT = 1
  resp[8] = 0;    resp[9] = 0             // NSCOUNT = 0
  resp[10] = 0;   resp[11] = 0            // ARCOUNT = 0
  resp[pos]     = 0xC0; resp[pos + 1]  = 0x0C  // name pointer
  resp[pos + 2] = 0x00; resp[pos + 3]  = 0x01  // Type A
  resp[pos + 4] = 0x00; resp[pos + 5]  = 0x01  // Class IN
  resp[pos + 6] = 0;    resp[pos + 7]  = 0      // TTL = 0
  resp[pos + 8] = 0;    resp[pos + 9]  = 0
  resp[pos + 10] = 0x00; resp[pos + 11] = 0x04  // RDLENGTH = 4
  resp[pos + 12] = 0;   resp[pos + 13] = 0      // 0.0.0.0
  resp[pos + 14] = 0;   resp[pos + 15] = 0
  return resp
}

function isDomainBlocked(domain) {
  if (!isBlocking) return false
  if (DOH_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) return true
  return sites.some(site => domain === site || domain.endsWith(`.${site}`))
}

function startDnsProxy() {
  return new Promise((resolve, reject) => {
    if (dnsServer) return resolve()
    dnsServer = dgram.createSocket('udp4')

    dnsServer.on('message', (msg, rinfo) => {
      const domain = parseDomainFromQuery(msg)
      if (isDomainBlocked(domain)) {
        dnsServer.send(buildBlockedResponse(msg), rinfo.port, rinfo.address)
        return
      }
      const upstream = dgram.createSocket('udp4')
      const timer = setTimeout(() => upstream.close(), 3000)
      upstream.on('message', response => {
        clearTimeout(timer)
        if (dnsServer) dnsServer.send(response, rinfo.port, rinfo.address)
        upstream.close()
      })
      upstream.on('error', () => { clearTimeout(timer); upstream.close() })
      upstream.send(msg, 53, UPSTREAM_DNS)
    })

    dnsServer.on('error', err => {
      try { dnsServer.close() } catch {}
      dnsServer = null
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          'A porta DNS local 127.0.0.1:53 já está em uso. Feche instâncias antigas do Bye Distraction pelo tray ou reinicie o app antes de ativar o bloqueio.'
        ))
        return
      }
      reject(err)
    })
    dnsServer.bind(53, '127.0.0.1', () => resolve())
  })
}

function stopDnsProxy() {
  if (dnsServer) {
    try { dnsServer.close() } catch {}
    dnsServer = null
  }
}

// ── Network interface DNS ─────────────────────────────────────────────────────

let savedInterfaces = []

function getConnectedInterfaces() {
  try {
    return execSync('netsh interface show interface', { encoding: 'utf-8' })
      .split('\n')
      .filter(line => /connected/i.test(line))
      .map(line => line.trim().split(/\s{2,}/).slice(-1)[0].trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function redirectDnsToProxy() {
  savedInterfaces = getConnectedInterfaces()
  for (const iface of savedInterfaces) {
    try {
      execSync(`netsh interface ip set dns "${iface}" static 127.0.0.1 primary`, { stdio: 'ignore' })
    } catch {}
  }
  execSync('ipconfig /flushdns', { stdio: 'ignore' })
}

function restoreDns() {
  const ifaces = savedInterfaces.length ? savedInterfaces : getConnectedInterfaces()
  for (const iface of ifaces) {
    try {
      execSync(`netsh interface ip set dns "${iface}" dhcp`, { stdio: 'ignore' })
    } catch {}
  }
  execSync('ipconfig /flushdns', { stdio: 'ignore' })
  savedInterfaces = []
}

// ── Firewall rules (secondary layer) ─────────────────────────────────────────

async function applyFirewallRules() {
  removeFirewallRules()
  if (!isBlocking || !sites.length) return
  const targets = sites.flatMap(s => getSiteTargets(s))
  const ips = new Set()
  await Promise.all(targets.map(async target => {
    try {
      const addrs = await dns.resolve4(target)
      addrs.forEach(ip => ips.add(ip))
    } catch {}
  }))
  if (!ips.size) return
  execSync(
    `netsh advfirewall firewall add rule name="BYE-DISTRACTION" dir=out action=block remoteip="${[...ips].join(',')}" enable=yes`,
    { stdio: 'ignore' }
  )
}

function removeFirewallRules() {
  try {
    execSync('netsh advfirewall firewall delete rule name="BYE-DISTRACTION"', { stdio: 'ignore' })
  } catch {}
}

// ── Main blocking orchestration ───────────────────────────────────────────────

async function applyBlocking() {
  applyHostsFile()

  if (isBlocking) {
    clearBrowserCaches()
    await startDnsProxy()
    redirectDnsToProxy()
  } else {
    stopDnsProxy()
    restoreDns()
  }

  applyDohBlock()
  await applyFirewallRules()
}

function deactivateBlockingForQuit() {
  deactivateBlockingLayers()
  isBlocking = false
  saveData()
}

function deactivateBlockingLayers() {
  try { stopDnsProxy() } catch {}
  try { restoreDns() } catch {}
  try { removeDohBlock() } catch {}
  try { removeFirewallRules() } catch {}
  try { removeHostsBlock() } catch {}
}

function persistBlockingForQuit() {
  try { stopDnsProxy() } catch {}
  try { restoreDns() } catch {}
  saveData()
}

// ── Window ────────────────────────────────────────────────────────────────────

const TRAY_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#315c48"/>
  <path d="M9 10.5h8.5a4.5 4.5 0 0 1 0 9H9v-9Z" fill="#fff"/>
  <path d="M13 14h9.5a4 4 0 0 1 0 8H13v-8Z" fill="#d4f7dc"/>
</svg>
`)

function createTrayIcon() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'bd.ico'))
  if (!icon.isEmpty()) return icon
  return nativeImage.createFromPath(process.execPath)
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.setSkipTaskbar(false)
  mainWindow.show()
  mainWindow.focus()
}

function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setSkipTaskbar(true)
  mainWindow.hide()
}

function quitApp() {
  isQuitting = true
  app.quit()
}

function createTray() {
  if (tray) return

  const trayIcon = createTrayIcon()
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createFromPath(process.execPath) : trayIcon)
  tray.setToolTip('Bye Distraction')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Bye Distraction', click: showMainWindow },
    { label: 'Ocultar', click: hideMainWindowToTray },
    { type: 'separator' },
    { label: 'Sair', click: quitApp }
  ]))

  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 620,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    },
    title: 'Bye Distraction',
    icon: path.join(__dirname, 'bd.ico'),
    autoHideMenuBar: true
  })
  mainWindow.loadFile('index.html')

  mainWindow.on('minimize', (event) => {
    event.preventDefault()
    hideMainWindowToTray()
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideMainWindowToTray()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (!isAdmin()) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Permissão necessária',
      message: 'Bye Distraction precisa de permissão de Administrador para bloquear sites.',
      detail: 'Deseja reiniciar como Administrador agora?',
      buttons: ['Reiniciar como Admin', 'Continuar sem permissão'],
      defaultId: 0,
      cancelId: 1
    })
    if (choice === 0) { relaunchAsAdmin(); return }
  }
  loadData()
  createTray()
  createWindow()
})

app.on('before-quit', () => {
  isQuitting = true
  if (tray) tray.destroy()
  if (isRelaunchingAsAdmin) return

  try {
    if (isBlocking && persistBlockingOnQuit) {
      persistBlockingForQuit()
    } else {
      deactivateBlockingForQuit()
    }
  } catch (err) {
    dialog.showErrorBox('Erro ao encerrar', err.message)
  }
})

app.on('window-all-closed', () => {})

app.on('activate', showMainWindow)

app.on('second-instance', showMainWindow)

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-state', () => getState())

ipcMain.handle('add-site', async (_, site) => {
  const normalizedSite = normalizeSite(site)
  if (!normalizedSite || sites.includes(normalizedSite)) return getState()

  sites.push(normalizedSite)
  saveData()
  await reapplyBlockingIfNeeded()
  return getState()
})

ipcMain.handle('remove-site', async (_, site) => {
  sites = sites.filter(s => s !== site)
  saveData()
  await reapplyBlockingIfNeeded()
  return getState()
})

ipcMain.handle('edit-site', async (_, { old: oldSite, new: newSite }) => {
  const normalizedSite = normalizeSite(newSite)
  if (!normalizedSite || sites.includes(normalizedSite)) return getState()

  sites = sites.map(s => s === oldSite ? normalizedSite : s)
  saveData()
  await reapplyBlockingIfNeeded()
  return getState()
})

ipcMain.handle('toggle-blocking', async () => {
  isBlocking = !isBlocking
  try {
    await applyBlocking()
    saveData()
  } catch (err) {
    isBlocking = !isBlocking
    deactivateBlockingLayers()
    saveData()
    dialog.showErrorBox('Erro ao aplicar bloqueio', err.message)
  }
  return getState()
})

ipcMain.handle('set-persist-blocking-on-quit', (_, value) => {
  persistBlockingOnQuit = Boolean(value)
  saveData()
  return getState()
})
