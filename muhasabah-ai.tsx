import { useState, useEffect, useRef } from "react";

const C = {
  night:"#0d1117", deep:"#141b25", card:"#1a2332", border:"#1e2d42",
  teal:"#2dd4bf", tealDim:"#1a7a70", gold:"#c9a84c", goldDim:"#7a6030",
  text:"#e2e8f0", muted:"#64748b", soft:"#94a3b8", danger:"#f87171",
};

const MOODS = [
  { id:"Tenang",   emoji:"🌙", context:"User rasa tenang. Refleksi mendalam — explore kenapa ketenangan tu terasa dan macam mana nak kekalkan." },
  { id:"Resah",    emoji:"🌊", context:"User rasa resah. Jangan terus fix. Tanya dulu apa yang buat resah, bagi dia rasa didengar dulu." },
  { id:"Kosong",   emoji:"🌫️", context:"User rasa kosong — mungkin disconnection dari diri atau dari Allah. Pendekatan perlahan, jangan overwhelm." },
  { id:"Bersalah", emoji:"🍂", context:"User rasa bersalah. Kenalpasti sama ada guilt tu healthy atau toxic. Tanya dengan lembut." },
  { id:"Keliru",   emoji:"🌪️", context:"User rasa keliru. Bantu fokus pada satu perkara dulu sebelum pergi lebih dalam." },
];

const memStore = {};
const store = {
  get:(k)=>{ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return memStore[k]??null; } },
  set:(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch{ memStore[k]=v; } },
};

// ── Claude API — correct messages array format ────────────
async function askClaude(prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  // Handle all possible response shapes
  if (data?.content?.[0]?.text) return data.content[0].text;
  if (data?.error) throw new Error(data.error.message);
  throw new Error("Unexpected: " + JSON.stringify(data).slice(0, 150));
}

function parseAIResponse(raw) {
  const ayahMatch = raw.match(/<ayah>([\s\S]*?)<\/ayah>/);
  const text = raw.replace(/<ayah>[\s\S]*?<\/ayah>/g,"").trim();
  let ayah = null;
  if (ayahMatch) {
    const c = ayahMatch[1];
    ayah = {
      arabic:      (c.match(/arabic:\s*(.+)/)||[])[1]?.trim(),
      translation: (c.match(/translation:\s*(.+)/)||[])[1]?.trim(),
      source:      (c.match(/source:\s*(.+)/)||[])[1]?.trim(),
    };
  }
  return { text, ayah };
}

function nowTime() { return new Date().toLocaleTimeString("ms-MY",{hour:"2-digit",minute:"2-digit"}); }
function getGreeting() {
  const h = new Date().getHours();
  if (h<12) return "Selamat pagi"; if (h<15) return "Selamat tengahari";
  if (h<19) return "Selamat petang"; return "Selamat malam";
}
function getStreak(sessions) {
  if (!sessions.length) return 0;
  const today=new Date().toDateString(), yest=new Date(Date.now()-86400000).toDateString();
  const last=new Date(sessions[sessions.length-1].date).toDateString();
  if (last!==today&&last!==yest) return 0;
  let streak=1, check=new Date(sessions[sessions.length-1].date);
  for (let i=sessions.length-2;i>=0;i--) {
    check.setDate(check.getDate()-1);
    if (new Date(sessions[i].date).toDateString()===check.toDateString()) streak++; else break;
  }
  return streak;
}

// ── Micro components ──────────────────────────────────────
function AyahCard({ayah}) {
  if (!ayah?.arabic&&!ayah?.translation) return null;
  return (
    <div style={{background:"rgba(201,168,76,0.07)",border:`1px solid ${C.goldDim}`,borderRadius:12,padding:"14px 16px",margin:"6px 0"}}>
      {ayah.arabic&&<div style={{fontFamily:"Georgia,serif",fontSize:18,color:C.gold,textAlign:"right",lineHeight:1.8,marginBottom:8}}>{ayah.arabic}</div>}
      {ayah.translation&&<div style={{fontSize:13,color:C.soft,fontStyle:"italic",lineHeight:1.6}}>"{ayah.translation}"</div>}
      {ayah.source&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>— {ayah.source}</div>}
    </div>
  );
}

function TypingDots() {
  return (
    <>
      <style>{`@keyframes td{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}`}</style>
      <div style={{display:"flex",gap:4,padding:"12px 16px",background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px 16px 16px 4px",width:"fit-content"}}>
        {[0,1,2].map(i=><div key={i} style={{width:6,height:6,background:C.muted,borderRadius:"50%",animation:`td 1.2s ${i*0.2}s infinite`}}/>)}
      </div>
    </>
  );
}

function Bubble({msg}) {
  const isAI = msg.role==="ai";
  return (
    <>
      <style>{`@keyframes fu{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:isAI?"flex-start":"flex-end",animation:"fu .25s ease"}}>
        <div style={{maxWidth:"85%",padding:"11px 15px",fontSize:14,lineHeight:1.65,
          background:isAI?C.card:"rgba(45,212,191,0.12)",
          border:`1px solid ${isAI?C.border:C.tealDim}`,
          borderRadius:isAI?"16px 16px 16px 4px":"16px 16px 4px 16px",color:C.text}}>
          {msg.text}
        </div>
        {msg.ayah&&<AyahCard ayah={msg.ayah}/>}
        <div style={{fontSize:10,color:C.muted,marginTop:3,padding:"0 4px",textAlign:isAI?"left":"right"}}>{msg.time}</div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════════
function HomeScreen({sessions,setSessions,onStart}) {
  const [mood,setMood]=useState(null);
  const streak=getStreak(sessions);
  const last=sessions.length?sessions[sessions.length-1]:null;
  const showFollowup=last?.niat&&new Date(last.date).toDateString()!==new Date().toDateString()&&last.niatStatus==="pending";

  const patterns=(()=>{
    if (sessions.length<3) return [];
    const recent=sessions.slice(-5), counts={};
    recent.forEach(s=>counts[s.mood]=(counts[s.mood]||0)+1);
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    const res=[];
    if (top[1]>=2){const m=MOODS.find(x=>x.id===top[0]);res.push(`${m?.emoji||""} ${top[1]} dari ${recent.length} sesi terakhir kau rasa ${top[0]}.`);}
    const done=sessions.filter(s=>s.niatStatus==="ya").length, tot=sessions.filter(s=>s.niat).length;
    if (tot>0){const pct=Math.round(done/tot*100);res.push(`✨ Kau capai niat kau ${pct}% daripada masa. ${pct>=60?"Konsisten tu.":"Niat kecil — tapi start somewhere."}`);}
    return res;
  })();

  function updateStatus(status) {
    const updated=sessions.map((s,i)=>i===sessions.length-1?{...s,niatStatus:status}:s);
    setSessions(updated); store.set("mhsb_sessions",updated);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",padding:"0 24px",flex:1}}>
      <div style={{padding:"28px 0 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:"Georgia,serif",fontSize:22,color:C.gold,lineHeight:1}}>محاسبة</div>
          <div style={{fontSize:10,color:C.muted,letterSpacing:"0.15em",textTransform:"uppercase",marginTop:3}}>Muhasabah AI</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(201,168,76,0.1)",border:`1px solid ${C.goldDim}`,padding:"5px 12px",borderRadius:20,fontSize:12,color:C.gold}}>
          🔥 {streak} hari
        </div>
      </div>

      <div style={{paddingBottom:24}}>
        <div style={{fontSize:11,color:C.muted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5}}>{getGreeting()}</div>
        <div style={{fontSize:22,fontWeight:300,color:C.text,lineHeight:1.35}}>
          Hati kau hari ni{" "}
          {mood?<span style={{color:C.teal,fontWeight:500}}>{mood.emoji} {mood.id.toLowerCase()}</span>
               :<span style={{color:C.muted}}>macam mana?</span>}
        </div>
      </div>

      <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:12}}>Keadaan hati sekarang</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:24}}>
        {MOODS.map(m=>(
          <button key={m.id} onClick={()=>setMood(m)} style={{
            background:mood?.id===m.id?"rgba(45,212,191,0.08)":C.card,
            border:`1px solid ${mood?.id===m.id?C.teal:C.border}`,
            borderRadius:12,padding:"11px 4px",display:"flex",flexDirection:"column",
            alignItems:"center",gap:5,cursor:"pointer",fontFamily:"inherit",transition:"all .18s",
          }}>
            <span style={{fontSize:20}}>{m.emoji}</span>
            <span style={{fontSize:9,color:mood?.id===m.id?C.teal:C.muted,textAlign:"center"}}>{m.id}</span>
          </button>
        ))}
      </div>

      {showFollowup&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:20,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:500,color:C.soft,marginBottom:10}}>🌙 Semalam kau niatkan...</div>
          <div style={{fontSize:14,color:C.text,fontStyle:"italic",lineHeight:1.6}}>{last.niat}</div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            {[["ya","✓ Ya",C.teal],["partial","◑ Separuh",C.gold],["no","✗ Belum",C.danger]].map(([s,lbl])=>(
              <button key={s} onClick={()=>updateStatus(s)} style={{flex:1,padding:"7px 4px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {patterns.length>0&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:20,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:500,color:C.soft,marginBottom:10}}>📊 Pattern kau</div>
          {patterns.map((p,i)=><div key={i} style={{fontSize:13,color:C.soft,lineHeight:1.6,marginBottom:i<patterns.length-1?8:0}}>{p}</div>)}
        </div>
      )}

      <button onClick={()=>mood&&onStart(mood)} style={{
        width:"100%",padding:15,marginTop:8,
        background:mood?`linear-gradient(135deg,${C.tealDim},rgba(45,212,191,0.28))`:C.card,
        border:`1px solid ${mood?C.teal:C.border}`,borderRadius:14,
        color:mood?C.teal:C.muted,fontSize:15,fontWeight:500,
        cursor:mood?"pointer":"not-allowed",fontFamily:"inherit",transition:"all .2s",
      }}>Mulakan Muhasabah →</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════
function ChatScreen({mood,onGoNiat,onBack}) {
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [exchN,setExchN]=useState(0);
  const [showNiat,setShowNiat]=useState(false);
  const bottomRef=useRef(null);
  const histRef=useRef([]);
  const startedRef=useRef(false);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);
  useEffect(()=>{ if(startedRef.current)return; startedRef.current=true; startSession(); },[]);

  async function startSession() {
    setLoading(true);
    const prompt=`Kau adalah teman muhasabah — bukan ustaz, bukan therapist. Cara kau: tenang, lembut, manusiawi. Guna Bahasa Melayu natural.

Mood user sekarang: ${mood.id} ${mood.emoji}
Context: ${mood.context}

Bagi satu mesej pembuka yang acknowledge mood dia, dan tanya SATU soalan spesifik dan mendalam. Soalan kena kena dengan mood ${mood.id}.

Kalau betul-betul kena, boleh include:
<ayah>
arabic: [teks arab]
translation: [terjemahan Melayu]
source: [nama surah/hadith]
</ayah>

Balas 3-5 ayat sahaja. Jangan ceramah.`;

    try {
      const raw = await askClaude(prompt);
      histRef.current=[{role:"assistant",content:raw}];
      const {text,ayah}=parseAIResponse(raw);
      setMessages([{role:"ai",text,ayah,time:nowTime()}]);
    } catch(e) {
      setMessages([{role:"ai",text:"Ralat: "+e.message,time:nowTime()}]);
    }
    setLoading(false);
  }

  async function send() {
    if (!input.trim()||loading) return;
    const userText=input.trim();
    setInput("");
    setMessages(prev=>[...prev,{role:"user",text:userText,time:nowTime()}]);
    histRef.current.push({role:"user",content:userText});
    setLoading(true);
    const newN=exchN+1; setExchN(newN);

    try {
      let raw="";
      if (newN>=3) {
        const p=`Kau teman muhasabah. Sesi fasa akhir.
Mood: ${mood.id}
Conversation:
${histRef.current.map(m=>`${m.role}: ${m.content}`).join("\n")}

Bagi closing warm dan cadangkan satu niat kecil spesifik berdasarkan apa yang dia share. Tanya kalau dia ready. Pendek, warm, jangan ceramah.`;
        raw=await askClaude(p);
        setShowNiat(true);
      } else {
        const fullPrompt=`Kau teman muhasabah. Lembut, tenang, manusiawi. Bahasa Melayu natural.
Mood asal: ${mood.id} ${mood.emoji}. Context: ${mood.context}

Conversation setakat ni:
${histRef.current.map(m=>`${m.role}: ${m.content}`).join("\n")}

User baru cakap: ${userText}

Cara respond: Acknowledge apa yang dia cakap (1-2 ayat), tanya satu soalan follow-up lebih dalam. Boleh connect dengan konsep Islam tapi jangan forced. Boleh include <ayah>...</ayah> kalau relevan. JANGAN ceramah. 3-5 ayat sahaja.`;
        raw=await askClaude(fullPrompt);
      }
      histRef.current.push({role:"assistant",content:raw});
      const {text,ayah}=parseAIResponse(raw);
      setMessages(prev=>[...prev,{role:"ai",text,ayah,time:nowTime()}]);
    } catch(e) {
      setMessages(prev=>[...prev,{role:"ai",text:"Ralat: "+e.message,time:nowTime()}]);
    }
    setLoading(false);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,padding:"0 24px",overflow:"hidden"}}>
      <div style={{padding:"18px 0 14px",borderBottom:`1px solid ${C.border}`,marginBottom:18,display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:20,lineHeight:1,padding:4}}>←</button>
        <div style={{flex:1}}>
          <div style={{fontSize:16,fontWeight:500,color:C.text}}>Muhasabah</div>
          <div style={{fontSize:12,color:C.muted,marginTop:1}}>Refleksi hari ini</div>
        </div>
        <div style={{background:"rgba(45,212,191,0.1)",border:`1px solid ${C.tealDim}`,color:C.teal,fontSize:11,padding:"4px 10px",borderRadius:20}}>
          {mood.emoji} {mood.id}
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:14,paddingBottom:12}}>
        {messages.map((m,i)=><Bubble key={i} msg={m}/>)}
        {loading&&<TypingDots/>}
        {showNiat&&!loading&&(
          <button onClick={onGoNiat} style={{width:"100%",padding:14,background:`linear-gradient(135deg,${C.tealDim},rgba(45,212,191,0.28))`,border:`1px solid ${C.teal}`,borderRadius:14,color:C.teal,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit",marginTop:6}}>
            Tetapkan Niat Kecil →
          </button>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{paddingTop:14,borderTop:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"flex-end"}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Tulis apa yang terasa..." rows={1}
          style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"11px 14px",color:C.text,fontSize:14,fontFamily:"inherit",resize:"none",minHeight:44,lineHeight:1.5,outline:"none"}}/>
        <button onClick={send} disabled={loading||!input.trim()} style={{width:44,height:44,background:loading||!input.trim()?C.border:C.tealDim,border:"none",borderRadius:12,color:"white",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>↑</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// NIAT
// ══════════════════════════════════════════════════════════
function NiatScreen({mood,sessions,setSessions,onDone,onBack}) {
  const [niat,setNiat]=useState("");
  const [saved,setSaved]=useState(false);
  function save() {
    if (!niat.trim()||saved) return;
    const s={id:Date.now(),date:new Date().toISOString(),mood:mood.id,moodEmoji:mood.emoji,niat:niat.trim(),niatStatus:"pending"};
    const updated=[...sessions,s]; setSessions(updated); store.set("mhsb_sessions",updated);
    setSaved(true); setTimeout(onDone,1400);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",flex:1,padding:"0 24px"}}>
      <div style={{padding:"18px 0 14px",borderBottom:`1px solid ${C.border}`,marginBottom:22,display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:20,lineHeight:1,padding:4}}>←</button>
        <div>
          <div style={{fontSize:16,fontWeight:500,color:C.text}}>Niat Kecil</div>
          <div style={{fontSize:12,color:C.muted,marginTop:1}}>Satu langkah untuk esok</div>
        </div>
      </div>
      <div style={{fontSize:14,color:C.soft,lineHeight:1.7,marginBottom:22}}>
        Muhasabah yang baik berakhir dengan satu tindakan kecil. Bukan azam besar — cukup satu perkara yang boleh kau bawa esok.
      </div>
      <textarea value={niat} onChange={e=>setNiat(e.target.value)} rows={4}
        placeholder="Contoh: Nak ambil masa 5 minit sebelum tidur untuk bersyukur atas satu benda..."
        style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,color:C.text,fontSize:14,fontFamily:"inherit",resize:"none",lineHeight:1.6,outline:"none",marginBottom:8}}/>
      <div style={{fontSize:12,color:C.muted,marginBottom:20,lineHeight:1.5}}>💡 Kecil dan spesifik lebih baik dari besar tapi samar.</div>
      <button onClick={save} disabled={!niat.trim()||saved} style={{
        width:"100%",padding:15,
        background:saved?"rgba(45,212,191,0.18)":!niat.trim()?C.card:`linear-gradient(135deg,${C.tealDim},rgba(45,212,191,0.28))`,
        border:`1px solid ${!niat.trim()?C.border:C.teal}`,borderRadius:14,
        color:!niat.trim()?C.muted:C.teal,fontSize:15,fontWeight:500,
        cursor:!niat.trim()||saved?"not-allowed":"pointer",fontFamily:"inherit",
      }}>{saved?"✓ Niat disimpan":"Simpan Niat →"}</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════════════
function HistoryScreen({sessions}) {
  const sorted=[...sessions].reverse();
  const stCfg={
    ya:{lbl:"✓ Tercapai",bg:"rgba(45,212,191,0.1)",col:C.teal},
    partial:{lbl:"◑ Separuh",bg:"rgba(201,168,76,0.1)",col:C.gold},
    no:{lbl:"✗ Belum",bg:"rgba(248,113,113,0.1)",col:C.danger},
    pending:{lbl:"⏳ Belum follow up",bg:"rgba(100,116,139,0.1)",col:C.muted},
  };
  if (!sorted.length) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flex:1,gap:12,padding:40,color:C.muted,textAlign:"center"}}>
      <div style={{fontSize:40,opacity:.5}}>🌙</div>
      <div style={{fontSize:14,lineHeight:1.6}}>Belum ada sesi muhasabah.<br/>Mulakan perjalanan kau hari ni.</div>
    </div>
  );
  return (
    <div style={{padding:"24px 24px 0",flex:1,overflowY:"auto"}}>
      <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.muted,marginBottom:5}}>Perjalanan kau</div>
      <div style={{fontSize:20,fontWeight:300,color:C.text,marginBottom:20}}>Refleksi lepas</div>
      {sorted.map(s=>{
        const d=new Date(s.date).toLocaleDateString("ms-MY",{weekday:"long",day:"numeric",month:"long"});
        const st=stCfg[s.niatStatus]||stCfg.pending;
        return (
          <div key={s.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:12}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:5}}>{d}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{fontSize:17}}>{s.moodEmoji}</span>
              <span style={{fontSize:13,color:C.soft}}>{s.mood}</span>
            </div>
            {s.niat?(
              <>
                <div style={{fontSize:13,color:C.text,fontStyle:"italic",lineHeight:1.5,borderLeft:`2px solid ${C.tealDim}`,paddingLeft:10,marginTop:6}}>{s.niat}</div>
                <div style={{display:"inline-flex",fontSize:11,marginTop:8,padding:"3px 8px",borderRadius:10,background:st.bg,color:st.col}}>{st.lbl}</div>
              </>
            ):<div style={{fontSize:12,color:C.muted,marginTop:4}}>Tiada niat ditetapkan</div>}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════
export default function App() {
  const [screen,setScreen]=useState("home");
  const [sessions,setSessions]=useState(()=>store.get("mhsb_sessions")||[]);
  const [mood,setMood]=useState(null);

  return (
    <div style={{background:C.night,color:C.text,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,backgroundImage:`radial-gradient(1px 1px at 18% 14%,rgba(255,255,255,.14) 0%,transparent 100%),radial-gradient(1px 1px at 78% 24%,rgba(255,255,255,.10) 0%,transparent 100%),radial-gradient(1px 1px at 50% 58%,rgba(255,255,255,.07) 0%,transparent 100%)`}}/>
      <div style={{width:"100%",maxWidth:480,minHeight:"100vh",display:"flex",flexDirection:"column",position:"relative",zIndex:1,paddingBottom:screen==="home"||screen==="history"?68:0}}>

        {screen==="home"    && <HomeScreen    sessions={sessions} setSessions={setSessions} onStart={m=>{setMood(m);setScreen("chat");}}/>}
        {screen==="chat"    && <ChatScreen    mood={mood} onGoNiat={()=>setScreen("niat")} onBack={()=>setScreen("home")}/>}
        {screen==="niat"    && <NiatScreen    mood={mood} sessions={sessions} setSessions={setSessions} onDone={()=>setScreen("home")} onBack={()=>setScreen("chat")}/>}
        {screen==="history" && <HistoryScreen sessions={sessions}/>}

        {(screen==="home"||screen==="history")&&(
          <nav style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:C.deep,borderTop:`1px solid ${C.border}`,display:"flex",zIndex:100}}>
            {[["home","🌙","Hari Ini"],["history","📖","Sejarah"]].map(([s,icon,lbl])=>(
              <button key={s} onClick={()=>setScreen(s)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"10px 8px",background:"none",border:"none",color:screen===s?C.teal:C.muted,fontSize:10,fontFamily:"inherit",cursor:"pointer",transition:"color .2s"}}>
                <span style={{fontSize:19}}>{icon}</span>{lbl}
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
