const elements = {
  toggleBtn: document.getElementById('toggle-btn'),
  siteInput: document.getElementById('site-input'),
  addBtn: document.getElementById('add-btn'),
  statusDot: document.getElementById('status-dot'),
  statusTitle: document.getElementById('status-title'),
  siteCount: document.getElementById('site-count'),
  listChip: document.getElementById('list-chip'),
  persistToggle: document.getElementById('persist-toggle'),
  emptyState: document.getElementById('empty-state'),
  siteList: document.getElementById('site-list'),
  editModal: document.getElementById('edit-modal'),
  editInput: document.getElementById('edit-input'),
  editConfirm: document.getElementById('edit-confirm'),
  editCancel: document.getElementById('edit-cancel'),
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingMsg: document.getElementById('loading-msg')
}

let editingTarget = null

function setLoading(active, msg = 'Aplicando...') {
  elements.loadingMsg.textContent = msg
  elements.loadingOverlay.classList.toggle('hidden', !active)
  elements.toggleBtn.disabled = active
  elements.addBtn.disabled = active
  elements.persistToggle.disabled = active
}

async function withLoading(message, action) {
  setLoading(true, message)
  try {
    const state = await action()
    renderState(state)
  } finally {
    setLoading(false)
  }
}

function createSiteButton(site, className, label, onClick) {
  const button = document.createElement('button')
  button.className = className
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', `${label} ${site}`)
  button.textContent = label
  button.addEventListener('click', () => onClick(site))
  return button
}

function createSiteItem(site) {
  const item = document.createElement('li')

  const name = document.createElement('span')
  name.className = 'site-name'
  name.textContent = site

  const meta = document.createElement('span')
  meta.className = 'site-meta'
  meta.textContent = 'Domínio'

  const copy = document.createElement('div')
  copy.className = 'site-copy'
  copy.append(name, meta)

  const actions = document.createElement('div')
  actions.className = 'site-actions'
  actions.append(
    createSiteButton(site, 'btn-edit', 'Editar', openEdit),
    createSiteButton(site, 'btn-remove', 'Remover', removeSite)
  )

  item.append(copy, actions)
  return item
}

function renderState({ sites, isBlocking, persistBlockingOnQuit }) {
  elements.toggleBtn.textContent = isBlocking ? 'Desativar Bloqueio' : 'Ativar Bloqueio'
  elements.toggleBtn.className = 'toggle-btn ' + (isBlocking ? 'active' : 'inactive')
  elements.statusDot.className = 'status-dot ' + (isBlocking ? 'active' : 'inactive')
  elements.statusTitle.textContent = isBlocking ? 'Bloqueio ativo' : 'Bloqueio inativo'
  elements.siteCount.textContent = `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} na lista`
  elements.listChip.textContent = sites.length ? `${sites.length}` : 'Vazia'
  elements.persistToggle.checked = persistBlockingOnQuit
  elements.emptyState.classList.toggle('hidden', sites.length > 0)

  elements.siteList.replaceChildren(...sites.map(createSiteItem))
}

function openEdit(site) {
  editingTarget = site
  elements.editInput.value = site
  elements.editModal.classList.remove('hidden')
  elements.editInput.focus()
}

function closeEdit() {
  elements.editModal.classList.add('hidden')
  editingTarget = null
}

function removeSite(site) {
  return withLoading('Removendo site...', () => window.api.removeSite(site))
}

elements.editConfirm.addEventListener('click', async () => {
  const newVal = elements.editInput.value.trim()
  if (!newVal) return
  const oldVal = editingTarget
  closeEdit()
  await withLoading('Atualizando bloqueio...', () => window.api.editSite(oldVal, newVal))
})

elements.editCancel.addEventListener('click', closeEdit)

elements.addBtn.addEventListener('click', async () => {
  const val = elements.siteInput.value.trim()
  if (!val) return
  elements.siteInput.value = ''
  await withLoading('Adicionando site...', () => window.api.addSite(val))
})

elements.siteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') elements.addBtn.click()
})

elements.toggleBtn.addEventListener('click', async () => {
  const next = elements.toggleBtn.classList.contains('inactive')
  await withLoading(
    next ? 'Ativando bloqueio...' : 'Desativando bloqueio...',
    () => window.api.toggleBlocking()
  )
})

elements.persistToggle.addEventListener('change', async () => {
  const state = await window.api.setPersistBlockingOnQuit(elements.persistToggle.checked)
  renderState(state)
})

window.api.getState().then(renderState)
