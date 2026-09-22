import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron'
import { join } from 'path'
import { registerAllIpcHandlers } from './ipc'
import { initDatabase } from './db'
import { startScheduler } from './services/scheduler'

// 必须在 app.whenReady() 之前设置，否则 dev 模式下 Electron 会用 package.json 的 name
// (stock-mind) 作为 userData，导致 Local Storage / Session Storage 等落到 stock-mind 目录，
// 与 SQLite 数据库 (com.stockmind.app) 分裂。
app.setName('com.stockmind.app')
if (process.platform === 'win32') {
    app.setAppUserModelId('com.stockmind.app')
}

let mainWindow: BrowserWindow | null = null
let petWindow: BrowserWindow | null = null
// 桌宠默认隐藏，可通过 pet:show IPC 重新开启
let petEnabled = false

function createWindow(): void {
    if (mainWindow && !mainWindow.isDestroyed()) return

    const window = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            backgroundThrottling: true,
        },
    })
    mainWindow = window

    window.on('ready-to-show', () => {
        window.show()
    })

    window.on('closed', () => {
        if (mainWindow === window) mainWindow = null
    })

    window.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
        window.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        window.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

function showMainWindow(route?: string): void {
    createWindow()
    const window = mainWindow
    if (!window) return

    const show = () => {
        window.show()
        window.focus()
        if (route) window.webContents.send('navigate-to', route)
    }
    if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', show)
    } else {
        show()
    }
}

function createPetWindow(): void {
    if (!petEnabled || (petWindow && !petWindow.isDestroyed())) return

    const window = new BrowserWindow({
        width: 160,
        height: 200,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        hasShadow: false,
        show: false,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            backgroundThrottling: true,
        },
    })
    petWindow = window

    window.on('ready-to-show', () => {
        if (petEnabled) window.show()
    })

    window.on('closed', () => {
        if (petWindow === window) petWindow = null
    })

    // 隐藏菜单栏
    window.setMenu(null)

    // 设置初始位置（屏幕右下角）
    const { screen } = require('electron')
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize
    window.setPosition(width - 200, height - 240)

    // 加载桌宠页面
    if (process.env['ELECTRON_RENDERER_URL']) {
        window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pet.html`)
    } else {
        window.loadFile(join(__dirname, '../renderer/pet.html'))
    }

    // 右键菜单
    const petMenu = Menu.buildFromTemplate([
        {
            label: '打开主窗口',
            click: () => showMainWindow(),
        },
        {
            label: 'AI 对话',
            click: () => showMainWindow('/chat'),
        },
        {
            type: 'separator',
        },
        {
            label: '隐藏桌宠',
            click: () => {
                petEnabled = false
                petWindow?.destroy()
            },
        },
        {
            label: '退出应用',
            click: () => {
                app.quit()
            },
        },
    ])

    window.webContents.on('context-menu', (_, params) => {
        petMenu.popup({ window, x: params.x, y: params.y })
    })
}

// IPC: 显示/隐藏桌宠
ipcMain.handle('pet:show', () => {
    petEnabled = true
    createPetWindow()
    petWindow?.show()
    return true
})

ipcMain.handle('pet:hide', () => {
    petEnabled = false
    petWindow?.destroy()
    return true
})

// IPC: 更新桌宠状态
ipcMain.on('pet:update', (_e, state) => {
    petWindow?.webContents.send('pet:state', state)
})

// IPC: 移动桌宠窗口
ipcMain.handle('pet:move', (_e, x: number, y: number) => {
    petWindow?.setPosition(x, y)
    return true
})

// IPC: 获取桌宠窗口位置
ipcMain.handle('pet:getPosition', () => {
    if (petWindow) {
        const [x, y] = petWindow.getPosition()
        return { x, y }
    }
    return { x: 0, y: 0 }
})

// IPC: 调整桌宠窗口尺寸（滚轮缩放使用）
ipcMain.handle('pet:resize', (_e, width: number, height: number) => {
    if (!petWindow) return false
    const w = Math.max(80, Math.min(600, Math.round(width)))
    const h = Math.max(100, Math.min(720, Math.round(height)))
    petWindow.setSize(w, h)
    return true
})

app.whenReady().then(async () => {
    await initDatabase()
    registerAllIpcHandlers()
    startScheduler()
    createWindow()
    createPetWindow()

    app.on('activate', function () {
        showMainWindow()
        if (petEnabled) createPetWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
