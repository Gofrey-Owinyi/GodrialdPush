// GodriadMedia Push Server - ZERO-DEP + FCM REST (v2)
// Still ZERO npm dependencies - uses only Node built-in http, https, crypto.
// Cannot fail with MODULE_NOT_FOUND.
// How FCM works here:
// - You set Env Var FIREBASE_SERVICE_ACCOUNT in Render = full JSON of serviceAccountKey.json from Firebase
// - Server creates a JWT with the private_key, gets an access token from Google, then sends to FCM HTTP v1
// - No firebase-admin needed, no web-push needed, no VAPID Private needed.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const tokens = new Map();

// --- FCM helpers (zero-dep) ---
function base64url(buf){ return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function getServiceAccount(){
  try{
    if(process.env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }catch(e){ console.log('FIREBASE_SERVICE_ACCOUNT parse failed:', e.message); }
  return null;
}
let cachedToken = null, cachedExpiry = 0;
function getAccessToken(sa){
  return new Promise((resolve,reject)=>{
    if(cachedToken && Date.now() < cachedExpiry - 60000) return resolve(cachedToken);
    const now = Math.floor(Date.now()/1000);
    const header = base64url(JSON.stringify({alg:'RS256', typ:'JWT'}));
    const claim = base64url(JSON.stringify({iss: sa.client_email, scope:'https://www.googleapis.com/auth/firebase.messaging', aud:'https://oauth2.googleapis.com/token', exp: now+3600, iat: now}));
    const unsigned = header + '.' + claim;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    const sig = signer.sign(sa.private_key);
    const jwt = unsigned + '.' + base64url(sig);
    const postData = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt);
    const req = https.request({hostname:'oauth2.googleapis.com', path:'/token', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(postData)}}, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{
          const j=JSON.parse(d);
          if(j.access_token){ cachedToken=j.access_token; cachedExpiry=Date.now() + (j.expires_in||3600)*1000; return resolve(cachedToken); }
          reject(new Error('No access_token: '+d.slice(0,300)));
        }catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData); req.end();
  });
}
function fcmSend(sa, accessToken, message){
  return new Promise((resolve,reject)=>{
    const postData = JSON.stringify({message});
    const req = https.request({hostname:'fcm.googleapis.com', path:'/v1/projects/'+sa.project_id+'/messages:send', method:'POST', headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json','Content-Length':Buffer.byteLength(postData)}}, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=> resolve({status:res.statusCode, body:d.slice(0,500)}));
    });
    req.on('error', reject);
    req.write(postData); req.end();
  });
}

function sendJson(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  res.end(body);
}
function readBody(req){
  return new Promise((resolve)=>{
    let d=''; req.on('data',c=>{d+=c; if(d.length>1000000) req.destroy();});
    req.on('end',()=>{ try{ resolve(d?JSON.parse(d):{}); }catch(e){ resolve({}); } });
  });
}
const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  if(req.method==='OPTIONS'){ res.writeHead(200, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}); return res.end(); }
  if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/health')){
    const sa = getServiceAccount();
    return sendJson(res,200,{ok:true, msg:'GodriadMedia Push Server (ZERO-DEP + FCM REST) is running âœ…', users: tokens.size, fcm: sa ? 'ready - serviceAccount set' : 'waiting - add FIREBASE_SERVICE_ACCOUNT env in Render', version:'zero-dep-v2-fcm-rest'});
  }
  if(req.method==='POST' && url.pathname==='/api/push/subscribe'){
    const body = await readBody(req);
    const user = String(body.user||'').toLowerCase();
    if(!user) return sendJson(res,400,{ok:false, error:'user required'});
    if(body.fcmToken) tokens.set(user,{fcmToken:body.fcmToken, phone:body.phone||'', lastSeen:Date.now()});
    console.log('Subscribed:', user, 'total:', tokens.size);
    return sendJson(res,200,{ok:true, total:tokens.size});
  }
  if(req.method==='POST' && url.pathname==='/api/push/send'){
    const body = await readBody(req);
    const to = String(body.to||'').toLowerCase();
    if(!to) return sendJson(res,400,{ok:false, error:'to required'});
    const title = body.title || 'GodriadMedia';
    const msgBody = body.body || 'New activity';
    const type = String(body.type||'message');
    console.log('Push request:', type, '->', to);
    const sa = getServiceAccount();
    // Try FCM if serviceAccount is set
    if(sa){
      try{
        const token = await getAccessToken(sa);
        const entry = tokens.get(to);
        let message = null;
        if(entry && entry.fcmToken){
          message = { token: entry.fcmToken, notification:{title, body:msgBody}, data:{type, url:'https://godriadmedia.vercel.app/', from:String((body.data&&body.data.from)||'')}, android:{priority:'HIGH', notification:{sound: type==='call'?'ring':'default', channelId: type==='call'?'godriad_calls':'godriad_messages'}}, apns:{payload:{aps:{sound: type==='call'?'ring.caf':'default'}}}};
        } else {
          // Fallback to topic: godriad_<user>
          const topic = 'godriad_' + to.replace(/[^a-z0-9]/g,'_');
          message = { topic, notification:{title, body:msgBody}, data:{type, url:'https://godriadmedia.vercel.app/'}, android:{priority:'HIGH'} };
        }
        const result = await fcmSend(sa, token, message);
        console.log('FCM result:', result.status, result.body.slice(0,200));
        if(result.status===200) return sendJson(res,200,{ok:true, via:'fcm-rest', to});
        return sendJson(res,200,{ok:true, via:'fcm-rest-failed', to, fcmStatus: result.status, note: result.body});
      }catch(e){ console.log('FCM send error:', e.message); return sendJson(res,200,{ok:true, via:'fcm-error', to, error: e.message}); }
    }
    console.log('No serviceAccount yet - realtime-only. Add FIREBASE_SERVICE_ACCOUNT in Render to enable FCM when closed.');
    return sendJson(res,200,{ok:true, via:'realtime-only', to, note:'Add FIREBASE_SERVICE_ACCOUNT env in Render to enable FCM when closed'});
  }
  return sendJson(res,404,{ok:false, error:'not found', path:url.pathname});
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, ()=> console.log('GodriadMedia Push Server (ZERO-DEP + FCM REST) on port', PORT));
