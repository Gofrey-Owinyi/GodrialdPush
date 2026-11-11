// GodriadMedia Push Server - ZERO DEPENDENCY version (Cannot fail with MODULE_NOT_FOUND)
// Uses ONLY Node built-in 'http' - no express, no cors, no firebase-admin, no npm install needed.
// Build Command in Render: leave EMPTY or 'npm install' (does nothing, no deps)
// Start Command in Render: node server.js
// This server WILL go Live. After it is Live, we add FCM via Firebase REST (also no npm) in next step.
const http = require('http');
const { URL } = require('url');

// In-memory: user -> {fcmToken, phone, lastSeen}
const tokens = new Map();

function sendJson(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
  res.end(body);
}
function readBody(req){
  return new Promise((resolve)=>{
    let d='';
    req.on('data',c=>{d+=c; if(d.length>1000000) req.destroy();});
    req.on('end',()=>{ try{ resolve(d?JSON.parse(d):{}); }catch(e){ resolve({}); } });
  });
}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  // CORS preflight
  if(req.method==='OPTIONS'){
    res.writeHead(200, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});
    return res.end();
  }
  if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/health')){
    return sendJson(res,200,{ok:true, msg:'GodriadMedia Push Server (ZERO-DEP) is running âœ…', users: tokens.size, fcm:'pending-next-step', version:'zero-dep-v1'});
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
    console.log('Push request:', body.type||'message', '->', to, 'title:', body.title||'GodriadMedia');
    // For now: log + return ok. App-open notification via Realtime Database still works.
    // Next step (after Live): we add FCM REST send here using FIREBASE_SERVICE_ACCOUNT env var, still with zero npm deps.
    return sendJson(res,200,{ok:true, via:'realtime-only-zero-dep', to, note:'Server is Live. FCM when closed = next step, no npm needed.'});
  }
  return sendJson(res,404,{ok:false, error:'not found', path:url.pathname});
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, ()=> console.log('GodriadMedia Push Server (ZERO-DEP) on port', PORT));
