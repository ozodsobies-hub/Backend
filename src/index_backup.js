const express = require('express')
const cors = require('cors')
const mysql = require('mysql2/promise')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 3000

// CORS - hamma joydan ruxsat
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Owner-Login','X-Owner-Pass'] }))
app.use(express.json())

// ═══ DB CONFIG ═══
const GAME_DB = {
  host: '188.127.241.8', port: 3306,
  user: 'gs136593', password: 'bT4B4WGCkdCr',
  database: 'gs136593', waitForConnections: true,
  connectionLimit: 10, connectTimeout: 10000
}

const SITE_DB = {
  host: process.env.SITE_DB_HOST || 'localhost',
  port: parseInt(process.env.SITE_DB_PORT || '3306'),
  user: process.env.SITE_DB_USER || 'shadowrp',
  password: process.env.SITE_DB_PASS || 'password',
  database: process.env.SITE_DB_NAME || 'shadowrp',
  waitForConnections: true, connectionLimit: 10, connectTimeout: 10000
}

let gamePool, sitePool

async function initDB() {
  try {
    gamePool = mysql.createPool(GAME_DB)
    const [rows] = await gamePool.query('SELECT 1')
    console.log('✅ Game DB ulandi!')
  } catch(e) {
    console.error('❌ Game DB xatosi:', e.message)
  }
  try {
    sitePool = mysql.createPool(SITE_DB)
    await sitePool.query('SELECT 1')
    console.log('✅ Site DB ulandi!')
    await createTables()
  } catch(e) {
    console.error('❌ Site DB xatosi:', e.message)
  }
}

async function createTables() {
  const db = await sitePool.getConnection()
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      player_name VARCHAR(64) NOT NULL,
      token VARCHAR(128) NOT NULL UNIQUE,
      ip VARCHAR(64), expires DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await db.query(`CREATE TABLE IF NOT EXISTS news (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL, content LONGTEXT NOT NULL,
      image_url VARCHAR(500), author VARCHAR(64) DEFAULT 'Owner',
      category VARCHAR(64) DEFAULT 'Yangilik', views INT DEFAULT 0,
      published TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await db.query(`CREATE TABLE IF NOT EXISTS complaints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      from_player VARCHAR(64) NOT NULL, to_player VARCHAR(64) NOT NULL,
      description TEXT NOT NULL, status ENUM('ochiq','korib_chiqilmoqda','yopiq') DEFAULT 'ochiq',
      admin_note TEXT, closed_by VARCHAR(64), ip VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await db.query(`CREATE TABLE IF NOT EXISTS complaint_images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      complaint_id INT NOT NULL, image_url VARCHAR(500) NOT NULL,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await db.query(`CREATE TABLE IF NOT EXISTS settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(64) UNIQUE NOT NULL,
      setting_value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await db.query(`CREATE TABLE IF NOT EXISTS admin_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admin_name VARCHAR(64), action VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    // Default settings
    await db.query(`INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
      ('apk_url','#'),('apk_version','1.0.0'),
      ('owner_login','Shadows'),('owner_pass','rp'),
      ('discord_link','https://discord.gg/bAbGcN4s2'),
      ('telegram_link','https://t.me/Shadows_Rp1'),
      ('youtube_link','https://www.youtube.com/@shadows_rp1')`)

    await db.query(`INSERT IGNORE INTO news (title,content,category) VALUES
      ('Shadows RP ochildi!','<h2>Xush kelibsiz!</h2><p>Shadows RP serveri rasman ochildi!</p>','Server yangiligi')`)

    console.log('✅ Jadvallar tayyor!')
  } finally { db.release() }
}

// ═══ HELPERS ═══
const getIP = (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '0.0.0.0'

const authCheck = async (req) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (!token) return null
  const [rows] = await sitePool.query('SELECT * FROM sessions WHERE token = ? AND expires > NOW()', [token])
  return rows[0] || null
}

const ownerCheck = async (req) => {
  const login = req.headers['x-owner-login'] || ''
  const pass = req.headers['x-owner-pass'] || ''
  if (!login || !pass) return false
  const [rows] = await sitePool.query("SELECT setting_value FROM settings WHERE setting_key IN ('owner_login','owner_pass')")
  const s = {}
  rows.forEach(r => s[r.setting_key] = r.setting_value)
  return login === (s.owner_login || 'Shadows') && pass === (s.owner_pass || 'rp')
}

const teamNames = { 0:'Fuqaro',1:'Politsiya',2:'Tibbiyot',3:'Armiya',4:'SWAT',5:'FIB',6:'Sheriff',7:"Yong'inchi",8:'Mehnat',9:"Yo'l xizmati" }

// ═══ AUTH ROUTES ═══

// Nick tekshirish
app.post('/auth/check', async (req, res) => {
  const { name } = req.body
  if (!name || !/^[A-Za-z]+_[A-Za-z]+$/.test(name)) return res.json({ error: 'Format: Ism_Familiya' })
  try {
    const [rows] = await gamePool.query('SELECT id,name,level FROM accounts WHERE name = ?', [name])
    if (!rows[0]) return res.json({ exists: false, message: "Bu nick o'yinda topilmadi" })
    res.json({ exists: true, name: rows[0].name, level: rows[0].level })
  } catch(e) { res.status(500).json({ error: 'DB xatosi: ' + e.message }) }
})

// Login
app.post('/auth/login', async (req, res) => {
  const { name, password } = req.body
  if (!name || !password) return res.json({ error: 'Nick va parol kerak' })
  if (!/^[A-Za-z]+_[A-Za-z]+$/.test(name)) return res.json({ error: 'Nick format: Ism_Familiya' })
  try {
    const [rows] = await gamePool.query(
      'SELECT id,name,password,salt,level,email,money,bank,admin,premium,online,totalhour,skin,team,donate_current,reg_time,last_login,health,jail,warn,donate_total FROM accounts WHERE name = ?',
      [name]
    )
    const player = rows[0]
    if (!player) return res.json({ error: "Bunday o'yinchi topilmadi" })

    const hashed = crypto.createHash('sha256').update(password + player.salt).digest('hex').toUpperCase()
    if (hashed !== player.password) return res.json({ error: "Parol noto'g'ri" })

    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
    const ip = getIP(req)

    await sitePool.query('DELETE FROM sessions WHERE player_name = ?', [name])
    await sitePool.query('INSERT INTO sessions (player_name,token,ip,expires) VALUES (?,?,?,?)', [name, token, ip, expires])

    res.json({ success: true, token, player: {
      id: player.id, name: player.name, level: player.level,
      email: player.email, money: player.money, bank: player.bank,
      admin: parseInt(player.admin), premium: parseInt(player.premium),
      online: parseInt(player.online), totalhour: player.totalhour || 0,
      skin: player.skin, team: teamNames[player.team] || 'Fuqaro',
      donate: player.donate_current, donate_total: player.donate_total,
      reg_time: new Date(player.reg_time * 1000).toLocaleDateString('uz-UZ'),
      last_login: new Date(player.last_login * 1000).toLocaleString('uz-UZ'),
      health: player.health, jail: player.jail, warn: player.warn, ip
    }})
  } catch(e) { res.status(500).json({ error: 'DB xatosi: ' + e.message }) }
})

// Profil
app.get('/auth/profile', async (req, res) => {
  const session = await authCheck(req)
  if (!session) return res.status(401).json({ error: 'Kirish talab qilinadi' })
  try {
    const [rows] = await gamePool.query(
      'SELECT id,name,level,email,money,bank,admin,premium,online,totalhour,skin,team,donate_current,donate_total,reg_time,last_login,health,jail,warn FROM accounts WHERE name = ?',
      [session.player_name]
    )
    const p = rows[0]
    if (!p) return res.status(404).json({ error: 'Topilmadi' })
    res.json({ success: true, player: {
      id: p.id, name: p.name, level: p.level, email: p.email,
      money: p.money?.toLocaleString(), bank: p.bank?.toLocaleString(),
      admin: parseInt(p.admin), premium: parseInt(p.premium), online: parseInt(p.online),
      totalhour: p.totalhour || 0, skin: p.skin, team: teamNames[p.team] || 'Fuqaro',
      donate: p.donate_current, donate_total: p.donate_total,
      reg_time: new Date(p.reg_time * 1000).toLocaleDateString('uz-UZ'),
      last_login: new Date(p.last_login * 1000).toLocaleString('uz-UZ'),
      health: p.health, jail: p.jail, warn: p.warn, ip: session.ip
    }})
  } catch(e) { res.status(500).json({ error: 'DB xatosi: ' + e.message }) }
})

// Logout
app.post('/auth/logout', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (token) await sitePool.query('DELETE FROM sessions WHERE token = ?', [token]).catch(() => {})
  res.json({ success: true })
})

// ═══ NEWS ROUTES ═══
app.get('/news', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 12), 50)
  const page = Math.max(parseInt(req.query.page || 1), 1)
  const offset = (page - 1) * limit
  try {
    const [[{ total }]] = await sitePool.query('SELECT COUNT(*) as total FROM news WHERE published=1')
    const [news] = await sitePool.query('SELECT id,title,image_url,author,category,views,created_at FROM news WHERE published=1 ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset])
    res.json({ success: true, news, total, pages: Math.ceil(total / limit) })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/news/:id', async (req, res) => {
  try {
    const [rows] = await sitePool.query('SELECT * FROM news WHERE id=? AND published=1', [req.body.id])
    if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' })
    await sitePool.query('UPDATE news SET views=views+1 WHERE id=?', [req.body.id])
    res.json({ success: true, news: rows[0] })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ═══ COMPLAINTS ROUTES ═══
app.post('/complaints', async (req, res) => {
  const session = await authCheck(req)
  if (!session) return res.status(401).json({ error: 'Kirish talab qilinadi' })
  const { to_player, description, images = [] } = req.body
  if (!to_player || !description) return res.json({ error: 'Barcha maydonlar kerak' })
  if (description.length < 20) return res.json({ error: 'Tavsif kamida 20 belgi' })
  if (session.player_name === to_player) return res.json({ error: "O'zingizga shikoyat yozib bo'lmaydi" })
  try {
    const [target] = await gamePool.query('SELECT name FROM accounts WHERE name=?', [to_player])
    if (!target[0]) return res.json({ error: "Bunday o'yinchi topilmadi" })
    const [result] = await sitePool.query('INSERT INTO complaints (from_player,to_player,description,ip) VALUES(?,?,?,?)', [session.player_name, to_player, description, getIP(req)])
    const cid = result.insertId
    for (const img of images.slice(0, 20)) {
      if (img && img.startsWith('http')) await sitePool.query('INSERT INTO complaint_images(complaint_id,image_url) VALUES(?,?)', [cid, img])
    }
    res.json({ success: true, id: cid })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/complaints/my', async (req, res) => {
  const session = await authCheck(req)
  if (!session) return res.status(401).json({ error: 'Kirish talab qilinadi' })
  try {
    const [rows] = await sitePool.query(`SELECT c.*,GROUP_CONCAT(ci.image_url) as images FROM complaints c LEFT JOIN complaint_images ci ON c.id=ci.complaint_id WHERE c.from_player=? GROUP BY c.id ORDER BY c.created_at DESC`, [session.player_name])
    rows.forEach(r => r.images = r.images ? r.images.split(',') : [])
    res.json({ success: true, complaints: rows })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/complaints/admin', async (req, res) => {
  const session = await authCheck(req)
  if (!session) return res.status(401).json({ error: 'Kirish kerak' })
  const [adm] = await gamePool.query('SELECT admin FROM accounts WHERE name=?', [session.player_name])
  if (!adm[0] || adm[0].admin < 1) return res.status(403).json({ error: "Ruxsat yo'q" })
  try {
    const status = req.query.status || ''
    const where = status ? 'WHERE c.status=?' : ''
    const params = status ? [status] : []
    const [rows] = await sitePool.query(`SELECT c.*,GROUP_CONCAT(ci.image_url) as images FROM complaints c LEFT JOIN complaint_images ci ON c.id=ci.complaint_id ${where} GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`, params)
    rows.forEach(r => r.images = r.images ? r.images.split(',') : [])
    res.json({ success: true, complaints: rows })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/complaints/close', async (req, res) => {
  const session = await authCheck(req)
  if (!session) return res.status(401).json({ error: 'Kirish kerak' })
  const [adm] = await gamePool.query('SELECT admin FROM accounts WHERE name=?', [session.player_name])
  if (!adm[0] || adm[0].admin < 1) return res.status(403).json({ error: "Ruxsat yo'q" })
  const { id, note, status } = req.body
  await sitePool.query('UPDATE complaints SET status=?,admin_note=?,closed_by=? WHERE id=?', [status || 'yopiq', note || '', session.player_name, id])
  await sitePool.query('INSERT INTO admin_logs(admin_name,action) VALUES(?,?)', [session.player_name, `Shikoyat #${id} ${status} qilindi`])
  res.json({ success: true })
})

// ═══ OWNER/STATS ROUTES ═══
app.get('/stats', async (req, res) => {
  try {
    const [[{ total }]] = await gamePool.query('SELECT COUNT(*) as total FROM accounts')
    const [[{ online }]] = await gamePool.query('SELECT COUNT(*) as online FROM accounts WHERE online=1')
    const [[{ admins }]] = await gamePool.query('SELECT COUNT(*) as admins FROM accounts WHERE admin>0')
    const [[{ news }]] = await sitePool.query('SELECT COUNT(*) as news FROM news WHERE published=1')
    const [[{ open }]] = await sitePool.query("SELECT COUNT(*) as open FROM complaints WHERE status='ochiq'")
    res.json({ success: true, stats: { total_players: total, online_players: online, total_admins: admins, total_news: news, open_complaints: open } })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/leaderboard', async (req, res) => {
  const orderMap = { level:'level', money:'money', hours:'totalhour' }
  const order = orderMap[req.query.type] || 'level'
  try {
    const [players] = await gamePool.query(`SELECT name,level,money,totalhour,online,admin,premium FROM accounts ORDER BY ${order} DESC LIMIT 20`)
    res.json({ success: true, players })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/settings', async (req, res) => {
  try {
    const [rows] = await sitePool.query('SELECT setting_key,setting_value FROM settings')
    const s = {}
    rows.forEach(r => s[r.setting_key] = r.setting_value)
    res.json({ success: true, settings: s })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/players', async (req, res) => {
  const isOwner = await ownerCheck(req)
  if (!isOwner) {
    const session = await authCheck(req)
    if (!session) return res.status(403).json({ error: "Ruxsat yo'q" })
    const [adm] = await gamePool.query('SELECT admin FROM accounts WHERE name=?', [session.player_name])
    if (!adm[0] || adm[0].admin < 1) return res.status(403).json({ error: "Ruxsat yo'q" })
  }
  try {
    const search = req.query.search || ''
    const limit = Math.min(parseInt(req.query.limit || 100), 500)
    const where = search ? 'WHERE name LIKE ?' : ''
    const params = search ? [`%${search}%`, limit] : [limit]
    const [players] = await gamePool.query(`SELECT id,name,level,money,admin,online,totalhour,last_login,premium,warn,jail FROM accounts ${where} ORDER BY level DESC LIMIT ?`, params)
    res.json({ success: true, players })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/admins', async (req, res) => {
  try {
    const [admins] = await gamePool.query('SELECT name,admin,online,totalhour,last_login FROM accounts WHERE admin>0 ORDER BY admin DESC')
    res.json({ success: true, admins })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// Owner routes
app.post('/owner/login', async (req, res) => {
  const { login, password } = req.body
  try {
    const [rows] = await sitePool.query("SELECT setting_key,setting_value FROM settings WHERE setting_key IN ('owner_login','owner_pass')")
    const s = {}
    rows.forEach(r => s[r.setting_key] = r.setting_value)
    if (login !== (s.owner_login || 'Shadows') || password !== (s.owner_pass || 'rp')) return res.status(401).json({ error: 'Login yoki parol xato' })
    res.json({ success: true, login })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/owner/news', async (req, res) => {
  if (!await ownerCheck(req)) return res.status(403).json({ error: "Ruxsat yo'q" })
  const { title, content, image_url, category } = req.body
  if (!title || !content) return res.json({ error: 'Sarlavha va kontent kerak' })
  try {
    const [result] = await sitePool.query("INSERT INTO news(title,content,image_url,category,author) VALUES(?,?,?,?,'Owner')", [title, content, image_url || null, category || 'Yangilik'])
    res.json({ success: true, id: result.insertId })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.post('/owner/news/delete', async (req, res) => {
  if (!await ownerCheck(req)) return res.status(403).json({ error: "Ruxsat yo'q" })
  await sitePool.query('DELETE FROM news WHERE id=?', [req.body.id])
  res.json({ success: true })
})

app.post('/owner/apk', async (req, res) => {
  if (!await ownerCheck(req)) return res.status(403).json({ error: "Ruxsat yo'q" })
  const { url, version } = req.body
  if (url) await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='apk_url'", [url])
  if (version) await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='apk_version'", [version])
  res.json({ success: true })
})

app.post('/owner/creds', async (req, res) => {
  if (!await ownerCheck(req)) return res.status(403).json({ error: "Ruxsat yo'q" })
  const { login, password } = req.body
  if (!login || !password) return res.json({ error: 'Login va parol kerak' })
  await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='owner_login'", [login])
  await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='owner_pass'", [password])
  res.json({ success: true })
})

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', message: 'ShadowRP API ishlayapti!' }))

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Server ${PORT} portda ishlamoqda!`))
})
