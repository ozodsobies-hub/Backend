const express = require('express')
const cors = require('cors')
const mysql = require('mysql2/promise')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','X-Owner-Login','X-Owner-Pass'] }))
app.use(express.json({ limit: '10mb' }))

const GAME_DB = { host:'188.127.241.8', port:3306, user:'gs136593', password:'bT4B4WGCkdCr', database:'gs136593', waitForConnections:true, connectionLimit:10, connectTimeout:15000 }
const SITE_DB = { host:process.env.SITE_DB_HOST||'localhost', port:parseInt(process.env.SITE_DB_PORT||'3306'), user:process.env.SITE_DB_USER||'root', password:process.env.SITE_DB_PASS||'', database:process.env.SITE_DB_NAME||'railway', waitForConnections:true, connectionLimit:10, connectTimeout:15000 }

let gamePool, sitePool

async function initDB() {
  try { gamePool = mysql.createPool(GAME_DB); await gamePool.query('SELECT 1'); console.log('✅ Game DB ulandi!') } catch(e) { console.error('❌ Game DB:', e.message) }
  try { sitePool = mysql.createPool(SITE_DB); await sitePool.query('SELECT 1'); console.log('✅ Site DB ulandi!'); await createTables() } catch(e) { console.error('❌ Site DB:', e.message) }
}

async function createTables() {
  const db = await sitePool.getConnection()
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS sessions (id INT AUTO_INCREMENT PRIMARY KEY, player_name VARCHAR(64) NOT NULL, token VARCHAR(128) NOT NULL UNIQUE, ip VARCHAR(64), expires DATETIME NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await db.query(`CREATE TABLE IF NOT EXISTS news (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, content LONGTEXT NOT NULL, image_url VARCHAR(500), video_url VARCHAR(500), author VARCHAR(64) DEFAULT 'Owner', category VARCHAR(64) DEFAULT 'Yangilik', views INT DEFAULT 0, published TINYINT DEFAULT 1, pinned TINYINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await db.query(`CREATE TABLE IF NOT EXISTS complaints (id INT AUTO_INCREMENT PRIMARY KEY, from_player VARCHAR(64) NOT NULL, to_player VARCHAR(64) NOT NULL, description TEXT NOT NULL, status ENUM('ochiq','korib_chiqilmoqda','yopiq') DEFAULT 'ochiq', admin_note TEXT, closed_by VARCHAR(64), ip VARCHAR(64), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await db.query(`CREATE TABLE IF NOT EXISTS complaint_images (id INT AUTO_INCREMENT PRIMARY KEY, complaint_id INT NOT NULL, image_url VARCHAR(500) NOT NULL, FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await db.query(`CREATE TABLE IF NOT EXISTS settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(64) UNIQUE NOT NULL, setting_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await db.query(`CREATE TABLE IF NOT EXISTS admin_logs (id INT AUTO_INCREMENT PRIMARY KEY, admin_name VARCHAR(64), action VARCHAR(255), details TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await db.query(`INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('apk_url','#'),('apk_version','1.0.0'),('owner_login','Shadows'),('owner_pass','rp'),('discord_link','https://discord.gg/bAbGcN4s2'),('telegram_link','https://t.me/Shadows_Rp1'),('youtube_link','https://www.youtube.com/@shadows_rp1'),('server_ip','play.shadowsrp.uz'),('server_name','Shadows RP'),('max_players','1000')`)
    await db.query(`INSERT IGNORE INTO news (title,content,category,pinned) VALUES ('Shadows RP ochildi!','<h2>Xush kelibsiz!</h2><p>Shadows RP serveri rasman ochildi!</p>','Server yangiligi',1)`)
    console.log('✅ Jadvallar tayyor!')
  } finally { db.release() }
}

const getIP = (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '0.0.0.0'
const fmt = (val) => val != null ? Number(val).toLocaleString('ru-RU') : '0'
const teamNames = {0:'Fuqaro',1:'Politsiya',2:'Tibbiyot',3:'Armiya',4:'SWAT',5:'FIB',6:'Sheriff',7:"Yong'inchi",8:'Mehnat',9:"Yo'l xizmati"}
const adminLvl = {0:"O'yinchi",1:'Yangi Admin',2:'Admin',3:'Senior Admin',4:'Bosh Admin',5:'Co-Owner',6:'Super Admin',13:'Owner'}

const authCheck = async (req) => {
  const token = (req.headers.authorization||'').replace('Bearer ','').trim()
  if (!token) return null
  try { const [r] = await sitePool.query('SELECT * FROM sessions WHERE token=? AND expires>NOW()',[token]); return r[0]||null } catch { return null }
}

const ownerCheck = async (req) => {
  const l=req.headers['x-owner-login']||'', p=req.headers['x-owner-pass']||''
  if (!l||!p) return false
  try {
    const [r] = await sitePool.query("SELECT setting_key,setting_value FROM settings WHERE setting_key IN ('owner_login','owner_pass')")
    const s={}; r.forEach(x=>s[x.setting_key]=x.setting_value)
    return l===(s.owner_login||'Shadows')&&p===(s.owner_pass||'rp')
  } catch { return false }
}

// AUTH
app.post('/auth/check', async (req,res) => {
  const {name}=req.body
  if(!name||!/^[A-Za-z]+_[A-Za-z]+$/.test(name)) return res.json({error:'Format: Ism_Familiya'})
  try { const [r]=await gamePool.query('SELECT name,level FROM accounts WHERE name=?',[name]); if(!r[0]) return res.json({exists:false,message:"Bu nick o'yinda topilmadi"}); res.json({exists:true,name:r[0].name,level:r[0].level}) } catch(e){res.status(500).json({error:'DB xatosi: '+e.message})}
})

app.post('/auth/login', async (req,res) => {
  const {name,password}=req.body
  if(!name||!password) return res.json({error:'Nick va parol kerak'})
  if(!/^[A-Za-z]+_[A-Za-z]+$/.test(name)) return res.json({error:'Nick format: Ism_Familiya'})
  try {
    const [r]=await gamePool.query('SELECT id,name,password,salt,level,email,money,bank,admin,premium,online,totalhour,skin,team,donate_current,reg_time,last_login,health,jail,warn,donate_total,score,coins FROM accounts WHERE name=?',[name])
    const p=r[0]; if(!p) return res.json({error:"Bunday o'yinchi topilmadi"})
    const h=crypto.createHash('sha256').update(password+p.salt).digest('hex').toUpperCase()
    if(h!==p.password) return res.json({error:"Parol noto'g'ri"})
    const token=crypto.randomBytes(32).toString('hex')
    const expires=new Date(Date.now()+7*24*60*60*1000).toISOString().slice(0,19).replace('T',' ')
    const ip=getIP(req)
    await sitePool.query('DELETE FROM sessions WHERE player_name=?',[name])
    await sitePool.query('INSERT INTO sessions (player_name,token,ip,expires) VALUES(?,?,?,?)',[name,token,ip,expires])
    res.json({success:true,token,player:{id:p.id,name:p.name,level:p.level,email:p.email,money:Number(p.money),money_fmt:fmt(p.money),bank:Number(p.bank),bank_fmt:fmt(p.bank),admin:parseInt(p.admin)||0,admin_name:adminLvl[parseInt(p.admin)]||"O'yinchi",premium:parseInt(p.premium)||0,online:parseInt(p.online)||0,totalhour:p.totalhour||0,skin:p.skin,team:teamNames[p.team]||'Fuqaro',donate:p.donate_current||0,donate_total:p.donate_total||0,score:p.score||0,coins:p.coins||0,reg_time:p.reg_time?new Date(p.reg_time*1000).toLocaleDateString('uz-UZ'):'—',last_login:p.last_login?new Date(p.last_login*1000).toLocaleString('uz-UZ'):'—',health:p.health||100,jail:p.jail||0,warn:p.warn||0,ip}})
  } catch(e){res.status(500).json({error:'DB xatosi: '+e.message})}
})

app.get('/auth/profile', async (req,res) => {
  const session=await authCheck(req); if(!session) return res.status(401).json({error:'Kirish talab qilinadi'})
  try {
    const [r]=await gamePool.query('SELECT id,name,level,email,money,bank,admin,premium,online,totalhour,skin,team,donate_current,donate_total,reg_time,last_login,health,jail,warn,score,coins,house,business,garage FROM accounts WHERE name=?',[session.player_name])
    const p=r[0]; if(!p) return res.status(404).json({error:'Topilmadi'})
    res.json({success:true,player:{id:p.id,name:p.name,level:p.level,email:p.email,money:Number(p.money),money_fmt:fmt(p.money),bank:Number(p.bank),bank_fmt:fmt(p.bank),admin:parseInt(p.admin)||0,admin_name:adminLvl[parseInt(p.admin)]||"O'yinchi",premium:parseInt(p.premium)||0,online:parseInt(p.online)||0,totalhour:p.totalhour||0,skin:p.skin,team:teamNames[p.team]||'Fuqaro',donate:p.donate_current||0,donate_total:p.donate_total||0,score:p.score||0,coins:p.coins||0,house:p.house||0,business:p.business||0,garage:p.garage||0,reg_time:p.reg_time?new Date(p.reg_time*1000).toLocaleDateString('uz-UZ'):'—',last_login:p.last_login?new Date(p.last_login*1000).toLocaleString('uz-UZ'):'—',health:p.health||100,jail:p.jail||0,warn:p.warn||0,ip:session.ip}})
  } catch(e){res.status(500).json({error:'DB xatosi: '+e.message})}
})

app.post('/auth/logout', async (req,res) => {
  const t=(req.headers.authorization||'').replace('Bearer ','').trim()
  if(t) await sitePool.query('DELETE FROM sessions WHERE token=?',[t]).catch(()=>{})
  res.json({success:true})
})

// NEWS
app.get('/news', async (req,res) => {
  const limit=Math.min(parseInt(req.query.limit||12),50), page=Math.max(parseInt(req.query.page||1),1), offset=(page-1)*limit, cat=req.query.category||''
  try {
    const w=cat?'AND category=?':'', params=cat?[cat,limit,offset]:[limit,offset]
    const [[{total}]]=await sitePool.query(`SELECT COUNT(*) as total FROM news WHERE published=1 ${w}`,cat?[cat]:[])
    const [news]=await sitePool.query(`SELECT id,title,image_url,video_url,author,category,views,pinned,created_at FROM news WHERE published=1 ${w} ORDER BY pinned DESC,created_at DESC LIMIT ? OFFSET ?`,params)
    res.json({success:true,news,total,pages:Math.ceil(total/limit)})
  } catch(e){res.status(500).json({error:e.message})}
})

app.get('/news/:id', async (req,res) => {
  try {
    const [r]=await sitePool.query('SELECT * FROM news WHERE id=? AND published=1',[req.params.id])
    if(!r[0]) return res.status(404).json({error:'Topilmadi'})
    await sitePool.query('UPDATE news SET views=views+1 WHERE id=?',[req.params.id])
    res.json({success:true,news:r[0]})
  } catch(e){res.status(500).json({error:e.message})}
})

// COMPLAINTS
app.post('/complaints', async (req,res) => {
  const session=await authCheck(req); if(!session) return res.status(401).json({error:'Kirish talab qilinadi'})
  const {to_player,description,images=[]}=req.body
  if(!to_player||!description) return res.json({error:'Barcha maydonlar kerak'})
  if(description.length<20) return res.json({error:'Tavsif kamida 20 belgi'})
  if(session.player_name===to_player) return res.json({error:"O'zingizga shikoyat yozib bo'lmaydi"})
  try {
    const [t]=await gamePool.query('SELECT name FROM accounts WHERE name=?',[to_player])
    if(!t[0]) return res.json({error:"Bunday o'yinchi topilmadi"})
    const [result]=await sitePool.query('INSERT INTO complaints (from_player,to_player,description,ip) VALUES(?,?,?,?)',[session.player_name,to_player,description,getIP(req)])
    const cid=result.insertId
    for(const img of images.slice(0,20)) if(img&&img.startsWith('http')) await sitePool.query('INSERT INTO complaint_images(complaint_id,image_url) VALUES(?,?)',[cid,img])
    res.json({success:true,id:cid})
  } catch(e){res.status(500).json({error:e.message})}
})

app.get('/complaints/my', async (req,res) => {
  const session=await authCheck(req); if(!session) return res.status(401).json({error:'Kirish talab qilinadi'})
  try {
    const [r]=await sitePool.query(`SELECT c.*,GROUP_CONCAT(ci.image_url) as images FROM complaints c LEFT JOIN complaint_images ci ON c.id=ci.complaint_id WHERE c.from_player=? GROUP BY c.id ORDER BY c.created_at DESC`,[session.player_name])
    r.forEach(x=>x.images=x.images?x.images.split(','):[])
    res.json({success:true,complaints:r})
  } catch(e){res.status(500).json({error:e.message})}
})

app.get('/complaints/admin', async (req,res) => {
  const session=await authCheck(req); if(!session) return res.status(401).json({error:'Kirish kerak'})
  try {
    const [a]=await gamePool.query('SELECT admin FROM accounts WHERE name=?',[session.player_name])
    if(!a[0]||a[0].admin<1) return res.status(403).json({error:"Ruxsat yo'q"})
    const status=req.query.status||'', w=status?'WHERE c.status=?':''
    const [r]=await sitePool.query(`SELECT c.*,GROUP_CONCAT(ci.image_url) as images FROM complaints c LEFT JOIN complaint_images ci ON c.id=ci.complaint_id ${w} GROUP BY c.id ORDER BY c.created_at DESC LIMIT 300`,status?[status]:[])
    r.forEach(x=>x.images=x.images?x.images.split(','):[])
    res.json({success:true,complaints:r})
  } catch(e){res.status(500).json({error:e.message})}
})

app.post('/complaints/close', async (req,res) => {
  const session=await authCheck(req); if(!session) return res.status(401).json({error:'Kirish kerak'})
  try {
    const [a]=await gamePool.query('SELECT admin FROM accounts WHERE name=?',[session.player_name])
    if(!a[0]||a[0].admin<1) return res.status(403).json({error:"Ruxsat yo'q"})
    const {id,note,status}=req.body
    await sitePool.query('UPDATE complaints SET status=?,admin_note=?,closed_by=? WHERE id=?',[status||'yopiq',note||'',session.player_name,id])
    await sitePool.query('INSERT INTO admin_logs(admin_name,action,details) VALUES(?,?,?)',[session.player_name,'Shikoyat yopildi',`#${id}`])
    res.json({success:true})
  } catch(e){res.status(500).json({error:e.message})}
})

// STATS & DATA
app.get('/stats', async (req,res) => {
  try {
    const [[{total}]]=await gamePool.query('SELECT COUNT(*) as total FROM accounts')
    const [[{online}]]=await gamePool.query('SELECT COUNT(*) as online FROM accounts WHERE online=1')
    const [[{admins}]]=await gamePool.query('SELECT COUNT(*) as admins FROM accounts WHERE admin>0')
    const [[{news}]]=await sitePool.query('SELECT COUNT(*) as news FROM news WHERE published=1')
    const [[{open}]]=await sitePool.query("SELECT COUNT(*) as open FROM complaints WHERE status='ochiq'")
    res.json({success:true,stats:{total_players:total,online_players:online,total_admins:admins,total_news:news,open_complaints:open}})
  } catch(e){res.status(500).json({error:e.message})}
})

app.get('/leaderboard', async (req,res) => {
  const om={level:'level',money:'money',hours:'totalhour',score:'score'}, order=om[req.query.type]||'level'
  try {
    const [p]=await gamePool.query(`SELECT name,level,money,totalhour,online,admin,premium,score FROM accounts ORDER BY ${order} DESC LIMIT 20`)
    p.forEach(x=>x.money_fmt=fmt(x.money))
    res.json({success:true,players:p})
  } catch(e){res.status(500).json({error:e.message})}
})

app.get('/settings', async (req,res) => {
  try { const [r]=await sitePool.query('SELECT setting_key,setting_value FROM settings'); const s={}; r.forEach(x=>s[x.setting_key]=x.setting_value); res.json({success:true,settings:s}) } catch(e){res.status(500).json({error:e.message})}
})

app.get('/players', async (req,res) => {
  const isOwner=await ownerCheck(req)
  if(!isOwner){const session=await authCheck(req);if(!session) return res.status(403).json({error:"Ruxsat yo'q"});const [a]=await gamePool.query('SELECT admin FROM accounts WHERE name=?',[session.player_name]);if(!a[0]||a[0].admin<1) return res.status(403).json({error:"Ruxsat yo'q"})}
  try {
    const search=req.query.search||'', limit=Math.min(parseInt(req.query.limit||100),500), w=search?'WHERE name LIKE ?':''
    const [p]=await gamePool.query(`SELECT id,name,level,money,admin,online,totalhour,last_login,premium,warn,jail,score FROM accounts ${w} ORDER BY level DESC LIMIT ?`,search?[`%${search}%`,limit]:[limit])
    p.forEach(x=>x.money_fmt=fmt(x.money))
    res.json({success:true,players:p,total:p.length})
  } catch(e){res.status(500).json({error:e.message})}
})

app.get('/admins', async (req,res) => {
  try { const [a]=await gamePool.query('SELECT name,admin,online,totalhour,last_login FROM accounts WHERE admin>0 ORDER BY admin DESC'); res.json({success:true,admins:a}) } catch(e){res.status(500).json({error:e.message})}
})

app.get('/player/:name', async (req,res) => {
  try {
    const [r]=await gamePool.query('SELECT name,level,money,admin,online,totalhour,premium,skin,team,score FROM accounts WHERE name=?',[req.params.name])
    if(!r[0]) return res.status(404).json({error:'Topilmadi'})
    const p=r[0]; p.money_fmt=fmt(p.money); p.team_name=teamNames[p.team]||'Fuqaro'; p.admin_name=adminLvl[parseInt(p.admin)]||"O'yinchi"
    res.json({success:true,player:p})
  } catch(e){res.status(500).json({error:e.message})}
})

// OWNER
app.post('/owner/login', async (req,res) => {
  const {login,password}=req.body
  try {
    const [r]=await sitePool.query("SELECT setting_key,setting_value FROM settings WHERE setting_key IN ('owner_login','owner_pass')")
    const s={}; r.forEach(x=>s[x.setting_key]=x.setting_value)
    if(login!==(s.owner_login||'Shadows')||password!==(s.owner_pass||'rp')) return res.status(401).json({error:'Login yoki parol xato'})
    res.json({success:true,login})
  } catch(e){res.status(500).json({error:e.message})}
})

app.post('/owner/news', async (req,res) => {
  if(!await ownerCheck(req)) return res.status(403).json({error:"Ruxsat yo'q"})
  const {title,content,image_url,video_url,category,pinned}=req.body
  if(!title||!content) return res.json({error:'Sarlavha va kontent kerak'})
  try {
    const [r]=await sitePool.query("INSERT INTO news(title,content,image_url,video_url,category,author,pinned) VALUES(?,?,?,?,?,'Owner',?)",[title,content,image_url||null,video_url||null,category||'Yangilik',pinned?1:0])
    res.json({success:true,id:r.insertId})
  } catch(e){res.status(500).json({error:e.message})}
})

app.post('/owner/news/delete', async (req,res) => {
  if(!await ownerCheck(req)) return res.status(403).json({error:"Ruxsat yo'q"})
  await sitePool.query('DELETE FROM news WHERE id=?',[req.body.id]); res.json({success:true})
})

app.post('/owner/news/pin', async (req,res) => {
  if(!await ownerCheck(req)) return res.status(403).json({error:"Ruxsat yo'q"})
  await sitePool.query('UPDATE news SET pinned=? WHERE id=?',[req.body.pinned?1:0,req.body.id]); res.json({success:true})
})

app.post('/owner/apk', async (req,res) => {
  if(!await ownerCheck(req)) return res.status(403).json({error:"Ruxsat yo'q"})
  const {url,version}=req.body
  if(url) await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='apk_url'",[url])
  if(version) await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='apk_version'",[version])
  res.json({success:true})
})

app.post('/owner/settings', async (req,res) => {
  if(!await ownerCheck(req)) return res.status(403).json({error:"Ruxsat yo'q"})
  const {key,value}=req.body; if(!key) return res.json({error:'key kerak'})
  await sitePool.query('INSERT INTO settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=?',[key,value,value])
  res.json({success:true})
})

app.post('/owner/creds', async (req,res) => {
  if(!await ownerCheck(req)) return res.status(403).json({error:"Ruxsat yo'q"})
  const {login,password}=req.body; if(!login||!password) return res.json({error:'Login va parol kerak'})
  await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='owner_login'",[login])
  await sitePool.query("UPDATE settings SET setting_value=? WHERE setting_key='owner_pass'",[password])
  res.json({success:true})
})

app.get('/owner/logs', async (req,res) => {
  if(!await ownerCheck(req)) return res.status(403).json({error:"Ruxsat yo'q"})
  const [l]=await sitePool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 100')
  res.json({success:true,logs:l})
})

// VAQTINCHALIK - owner reset (ishlatgach o'chirish kerak!)
app.get('/reset-owner-xK9mP', async (_,res) => {
  try {
    await sitePool.query("UPDATE settings SET setting_value='Shadows' WHERE setting_key='owner_login'")
    await sitePool.query("UPDATE settings SET setting_value='rp' WHERE setting_key='owner_pass'")
    res.json({success:true, message:"✅ Owner reset! Login: Shadows, Parol: rp"})
  } catch(e) { res.status(500).json({error:e.message}) }
})

app.get('/', (_,res) => res.json({status:'ok',message:'ShadowRP API 2.0 ishlayapti! 🚀'}))

initDB().then(() => app.listen(PORT,'0.0.0.0',()=>console.log(`✅ Server ${PORT} portda!`)))
