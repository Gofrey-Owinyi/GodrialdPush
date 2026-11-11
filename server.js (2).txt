// GodriadMedia Push Server - Makes calls ring + messages pop even when app is CLOSED
// HOW TO USE:
// 1. Upload this file to your server (Render / Railway / VPS) - NOT to Vercel static (Vercel cannot run a push server 24/7)
// 2. In Firebase Console > Project Settings > Service Accounts > Generate new private key -> Save as serviceAccountKey.json in same folder
// 3. In Firebase Console > Project Settings > Cloud Messaging > Web Push certificates > Generate key pair -> Copy VAPID public key
//    Paste that VAPID public key into your app: localStorage.setItem('gm_vapid','YOUR_VAPID_PUBLIC_KEY')
// 4. Run: npm install express web-push firebase-admin cors
// 5. Run: node server.js  (or deploy to Render/Railway with Start Command: node server.js)
// 6. In your app, set: fetch('/api/push/...') must point to YOUR server URL, e.g. https://godriad-push.onrender.com/api/push/send
// WITHOUT this server + FCM keys, the app can ONLY notify when it is OPEN. No code can ring a fully-closed web app without a push server - that is how Facebook/WhatsApp do it too.
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const admin = require('firebase-admin');
const app = express();
app.use(cors()); app.use(express.json());
let serviceAccount = null;
try { serviceAccount = require('./serviceAccountKey.json'); } catch(e){ console.log('No serviceAccountKey.json yet - FCM for Android native will be off, Web Push still works if VAPID set'); }
if (serviceAccount) { admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }); }
// TODO: Paste your VAPID keys here (from Firebase > Cloud Messaging > Web Push certificates)
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'PASTE_YOUR_VAPID_PUBLIC_KEY_HERE';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'PASTE_YOUR_VAPID_PRIVATE_KEY_HERE';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:godriadmedia@gmail.com';
if (VAPID_PUBLIC.startsWith('PASTE')) console.log('⚠️ Set VAPID keys - see top of server.js');
else webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const subs = new Map(); // userName -> {sub, phone}
app.post('/api/push/subscribe', (req,res)=>{
  const {user, phone, sub} = req.body||{};
  if(!user||!sub) return res.status(400).json({ok:false, error:'user + sub required'});
  subs.set(String(user).toLowerCase(), {sub, phone:phone||''});
  console.log('Subscribed:', user);
  return res.json({ok:true});
});
app.post('/api/push/send', async (req,res)=>{
  const {type, to, title, body, data} = req.body||{};
  if(!to) return res.status(400).json({ok:false, error:'to required'});
  const entry = subs.get(String(to).toLowerCase());
  const payload = JSON.stringify({title:title||'GodriadMedia', body:body||'New activity', type:type||'message', data:data||{}, url:'https://godriadmedia.vercel.app/'});
  // 1. Web Push (works when browser is closed but phone is on, if user allowed notifications)
  if (entry && entry.sub) {
    try { await webpush.sendNotification(entry.sub, payload); console.log('Web Push sent to', to, type); }
    catch(e){ console.log('Web Push failed for', to, e.message); if(e.statusCode===410||e.statusCode===404) subs.delete(String(to).toLowerCase()); }
  }
  // 2. FCM for Android native (if you later wrap app with Capacitor / Play Store)
  if (serviceAccount) {
    try {
      await admin.messaging().send({ topic:'godriad_'+String(to).toLowerCase().replace(/[^a-z0-9]/g,'_'), notification:{title:title||'GodriadMedia', body:body||'New activity'}, data:{type:String(type||'message'), click_action:'FLUTTER_NOTIFICATION_CLICK'} });
      console.log('FCM sent to', to);
    } catch(e){ console.log('FCM failed (user may not be subscribed to topic):', e.message); }
  }
  return res.json({ok:true, sentTo:to, via: entry?'web-push':'queued'});
});
app.get('/', (req,res)=> res.send('GodriadMedia Push Server is running ✅ - POST /api/push/subscribe and /api/push/send'));
const PORT = process.env.PORT || 3001;
app.listen(PORT, ()=> console.log('GodriadMedia Push Server on port', PORT));
