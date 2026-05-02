# Bye Distraction 👋

A lightweight, system-level website blocker for Windows that helps you maintain focus by preventing access to distracting websites. Bye Distraction runs at the OS level with multiple blocking layers to ensure websites cannot bypass the restrictions.

## Features

- **Simple, intuitive UI** — Manage your blocked website list with ease
- **Multi-layer blocking** — Combines hosts file, DNS proxy, firewall rules, and DoH blocking for maximum reliability
- **Persistent settings** — Save your blocked sites list between sessions
- **System tray integration** — Minimize to tray and control from taskbar
- **Administrator mode** — Automatically requests elevated privileges when needed
- **Browser cache clearing** — Clears browser caches when blocking is activated to prevent cached content bypass
- **DoH protection** — Blocks DNS-over-HTTPS to prevent circumventing local DNS
- **Portable** — Available as standalone .exe or source code

![front image](https://raw.githubusercontent.com/pedromarttins/bye-distraction/refs/heads/main/front.png)


## Technologies

- **[Electron](https://www.electronjs.org/)** — Cross-platform desktop application framework
- **Node.js** — Backend runtime
- **DNS Proxy** — Custom UDP DNS server for domain blocking
- **Windows Firewall API** — Rule-based IP blocking
- **Hosts File** — DNS-level domain blocking
- **netsh** — Network interface and firewall management

## Installation & Usage

### Running from Source

1. **Clone or download** the repository
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the application:**
   ```bash
   npm start
   ```
   > The app will request Administrator privileges on first run

### Running from .exe

Simply download and execute the `bye-distraction.exe` file. Administrator privileges will be requested automatically.

## How to Use

### Activate Blocking

1. Open the application
2. Enter a website domain (e.g., `reddit.com`, `youtube.com`) in the domain field
3. Click **Add** to add it to your blocked sites list
4. Click **Activate Blocking** to enable site blocking
5. Your sites are now blocked system-wide

### Deactivate Blocking

Click **Deactivate Blocking** to immediately restore access to all sites.

### Manage Blocked Sites

- **Edit** — Click the edit icon next to any site to modify it
- **Remove** — Click the remove icon to delete a site from the list
- **Persist Settings** — Toggle the "Persist blockings after closure" switch to keep your settings even after closing the app

### Domain Format

Accepted formats:
- `example.com` ✅
- `www.example.com` ✅
- `https://example.com` ✅
- `https://example.com/` ✅

All variants are automatically normalized to the base domain.

## How Blocking Works

Bye Distraction uses **four independent blocking layers** to ensure websites cannot be accessed:

### 1. **Hosts File**
- Modifies `C:\Windows\System32\drivers\etc\hosts` to redirect blocked domains to `0.0.0.0`
- Blocks the base domain and common subdomains (www, api, m, mobile, app, cdn, etc.)
- Effective for most browsers and applications

### 2. **DNS Proxy**
- Launches a local DNS server on `127.0.0.1:53`
- Intercepts all DNS queries for blocked domains
- Returns `0.0.0.0` for blocked sites
- Automatically redirects network interfaces to use the local DNS resolver
- Prevents DNS-level bypass attempts

### 3. **Firewall Rules**
- Resolves blocked domain names to their IP addresses
- Creates Windows Firewall outbound rules blocking traffic to those IPs
- Works against direct IP access attempts
- Secondary layer when DNS is circumvented

### 4. **DoH Blocking** (DNS-over-HTTPS)
- Blocks connections to known DoH server IPs (Google, Cloudflare, Quad9, OpenDNS)
- Prevents browsers from using HTTPS-based DNS to bypass local DNS
- Uses Windows Firewall to block TCP/UDP port 443 to known DoH servers
- Ensures browsers fall back to the system DNS resolver

### Supplementary Functions

- **Browser Cache Clearing** — Clears browser caches (Chrome, Edge, Brave, Firefox) when blocking is activated to prevent cached content from being served
- **DNS Flush** — Flushes local DNS cache when DNS settings change

## File Structure

```
bye-distraction/
├── main.js              # Electron main process, blocking logic
├── preload.js           # Preload script for IPC security
├── renderer.js          # Frontend logic
├── index.html           # UI markup
├── styles.css           # Styling
├── bd.ico               # Application icon
├── package.json         # Dependencies and metadata
└── README.md            # This file
```

## Security Notes

- The application requires **Administrator privileges** to modify system-level settings (hosts file, DNS, firewall)
- Context isolation is enabled in Electron to prevent XSS attacks
- IPC communication between renderer and main process is restricted
- The app is designed for local use only and requires manual operation

## Building an Executable

To create a standalone `.exe` file, you can use Electron packagers:

```bash
npm install --save-dev electron-builder
npx electron-builder
```

Outputs will be in the `dist/` directory.

## Requirements

- **Windows 7 or later** (Windows 10/11 recommended)
- **Administrator privileges** (required for blocking to work)
- **Node.js** (if running from source)

## Limitations

- **Windows only** — Built specifically for Windows using Windows-specific APIs
- **Manual activation** — Blocking must be manually toggled (no scheduling yet)
- **Requires admin rights** — Operating system limitations prevent non-admin blocking
- **Network-dependent** — Firewall rules require active internet connection for DNS resolution

## Troubleshooting

### "DNS port 53 already in use" error
Another instance of Bye Distraction is running. Close it via system tray or restart your computer.

### Admin permission denied
Right-click the executable and select "Run as Administrator" explicitly, or enable automatic admin mode in settings.

### Websites still accessible after enabling blocking
1. Clear your browser cache completely
2. Check that blocking is actually enabled (green indicator)
3. Try a different browser to rule out browser-level caching
4. Restart the app and try again

## Contributing

Feel free to open issues and pull requests to improve the application.

## License

MIT License — See LICENSE file for details

---

**Made with ❤️ for better focus** • [Report Issues](https://github.com/your-repo/bye-distraction/issues)
