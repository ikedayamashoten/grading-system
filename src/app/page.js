"use client";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
// PDFを1ページずつ画像に変換（CDN版pdf.js使用）
async function pdfToImages(file) {
  return new Promise(async (resolve, reject) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = async () => {
        try {
          const pdfjsLib = window["pdfjs-dist/build/pdf"];
          pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
          const images = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d");
            await page.render({ canvasContext: ctx, viewport }).promise;
            images.push(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
          }
          resolve(images);
        } catch(e) { reject(e); }
      };
      script.onerror = () => reject(new Error("pdf.jsの読み込みに失敗しました"));
      // すでに読み込み済みの場合
      if (window["pdfjs-dist/build/pdf"]) {
        script.onload();
        return;
      }
      document.head.appendChild(script);
    } catch(e) { reject(e); }
  });
}
const supabase = createClient(
  "https://tcatrrncukiipogccdnc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjYXRycm5jdWtpaXBvZ2NjZG5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzA5ODcsImV4cCI6MjA4OTc0Njk4N30.pbcdWibNAI4r9UmJ4bsale_Lc11HusUH-cSoeAobfZQ"
);

const fetchTemplates = async (schoolId) => {
  const { data, error } = await supabase.from("test_templates").select("*").eq("school_id", schoolId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
};
const saveTemplate = async (schoolId, name, subject, sections) => {
  const { error } = await supabase.from("test_templates").insert({ school_id: schoolId, name, subject, sections });
  if (error) throw error;
};
const deleteTemplate = async (id) => {
  const { error } = await supabase.from("test_templates").delete().eq("id", id);
  if (error) throw error;
};

const EDGE_URL = "https://tcatrrncukiipogccdnc.supabase.co/functions/v1/gemini-grade";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjYXRycm5jdWtpaXBvZ2NjZG5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzA5ODcsImV4cCI6MjA4OTc0Njk4N30.pbcdWibNAI4r9UmJ4bsale_Lc11HusUH-cSoeAobfZQ";

async function callEdge(payload) {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ANON_KEY}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Edge Functionエラー"); }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}

function extractJson(text) {
  const tryParse = (str) => {
    try { return JSON.parse(str); } catch(e) {}
    // 文字列値内の制御文字・改行を除去して再試行
    const fixed = str.replace(/"((?:[^"\\]|\\.)*)"/gs, (m, v) => {
      return '"' + v
        .replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") + '"';
    });
    try { return JSON.parse(fixed); } catch(e) {}
    return null;
  };

  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { const r = tryParse(arrMatch[0]); if (r) return r; }

  const start = text.indexOf("{");
  if (start === -1) throw new Error("JSONの取得に失敗しました");
  let depth = 0, end = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const jsonStr = text.slice(start, end + 1);
  const r = tryParse(jsonStr);
  if (r) return r;
  throw new Error("JSONのパースに失敗しました");
}

async function callGemini(imageBase64, mimeType, sections) {
  const text = await callEdge({ mode: "grade", imageBase64, mimeType, sections });
  return extractJson(text);
}

async function callGeminiPdf(pdfBase64, sections) {
  const text = await callEdge({ mode: "grade-pdf", imageBase64: pdfBase64, sections });
  const result = extractJson(text);
  return Array.isArray(result) ? result : [result];
}

async function callGeminiExtract(pdfBase64, mimeType) {
  const text = await callEdge({ mode: "extract", imageBase64: pdfBase64, mimeType });
  return extractJson(text);
}

const SUBJECT_COLORS = {
  国語:"bg-orange-100 text-orange-700 border-orange-200",数学:"bg-blue-100 text-blue-700 border-blue-200",
  英語:"bg-purple-100 text-purple-700 border-purple-200",外国語:"bg-purple-100 text-purple-700 border-purple-200",
  理科:"bg-green-100 text-green-700 border-green-200",社会:"bg-amber-100 text-amber-700 border-amber-200",
  地理歴史:"bg-rose-100 text-rose-700 border-rose-200",
};
const STATUS_CONFIG = {
  未着手:{color:"bg-slate-100 text-slate-500",dot:"bg-slate-400"},
  採点中:{color:"bg-amber-100 text-amber-700",dot:"bg-amber-500"},
  採点完了:{color:"bg-emerald-100 text-emerald-700",dot:"bg-emerald-500"},
};
const QUESTION_TYPES = [
  { value:"essay", label:"記述式", color:"bg-blue-100 text-blue-700", desc:"自由記述・論述" },
  { value:"choice", label:"選択肢", color:"bg-purple-100 text-purple-700", desc:"選択肢から選ぶ" },
  { value:"word", label:"単語・記号", color:"bg-emerald-100 text-emerald-700", desc:"完全一致で自動○×" },
];
const genId = () => Math.random().toString(36).slice(2);
const fileToBase64 = (f) => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(f); });
const moveUp = (arr,idx) => { if(idx===0) return arr; const n=[...arr]; [n[idx-1],n[idx]]=[n[idx],n[idx-1]]; return n; };
const moveDown = (arr,idx) => { if(idx===arr.length-1) return arr; const n=[...arr]; [n[idx],n[idx+1]]=[n[idx+1],n[idx]]; return n; };

export default function App() {
  const [screen, setScreen] = useState("login");
  const [tab, setTab] = useState("dashboard");
  const [school, setSchool] = useState(null);
  const [tests, setTests] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedTest, setSelectedTest] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const notify = useCallback((msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500); },[]);

  useEffect(()=>{
    if(!school) return;
    setLoadingData(true);
    Promise.all([
      supabase.from("tests").select("*").eq("school_id",school.id).order("created_at",{ascending:false}),
      supabase.from("school_settings").select("*").eq("school_id",school.id).single(),
    ]).then(([{data:testsData,error:te},{data:settings,error:se}])=>{
      if(!te) setTests((testsData||[]).map(t=>({...t,sections:t.sections||[]})));
      if(!se&&settings){ setClasses(settings.classes||[]); setSubjects(settings.subjects||[]); }
    }).finally(()=>setLoadingData(false));
  },[school]);

  const handleLogin=async(code,password)=>{
    const{data,error}=await supabase.rpc("verify_school_login",{p_code:code,p_password:password});
    if(error||!data?.length){ notify("IDまたはパスワードが違います","error"); return; }
    setSchool(data[0]); setScreen("main"); setTab("dashboard");
  };
  const handleSaveTest=async(testData)=>{
    const{data,error}=await supabase.from("tests").insert({...testData,school_id:school.id,status:"未着手"}).select().single();
    if(error){ notify(error.message,"error"); return null; }
    setTests(prev=>[data,...prev]); notify("テストを保存しました"); return data;
  };
  const handleSaveResults=async(testId,results)=>{
    const rows=results.map(r=>({test_id:testId,school_id:school.id,student_name:r.student_name,file_name:r.fileName||"",total_score:r.total_score||0,results:r.results||[],overall_comment:r.overall_comment||"",manually_adjusted:false}));
    const{error:re}=await supabase.from("grading_results").insert(rows);
    if(re){ notify(re.message,"error"); return; }
    await supabase.from("tests").update({status:"採点完了"}).eq("id",testId);
    setTests(prev=>prev.map(t=>t.id===testId?{...t,status:"採点完了"}:t));
    notify("採点結果をDBに保存しました");
  };
  const handleDeleteTest=async(testId)=>{
    const{error}=await supabase.from("tests").delete().eq("id",testId);
    if(error){ notify(error.message,"error"); return; }
    setTests(prev=>prev.filter(t=>t.id!==testId)); notify("テストを削除しました");
  };
  const handleSaveSettings=async(newClasses,newSubjects)=>{
    const{data:existing}=await supabase.from("school_settings").select("school_id").eq("school_id",school.id).single();
    const payload={school_id:school.id,classes:newClasses,subjects:newSubjects,updated_at:new Date().toISOString()};
    if(existing) await supabase.from("school_settings").update(payload).eq("school_id",school.id);
    else await supabase.from("school_settings").insert(payload);
    setClasses(newClasses); setSubjects(newSubjects); notify("設定を保存しました");
  };

  if(screen==="login") return <LoginScreen onLogin={handleLogin} toast={toast}/>;
  return (
    <div className="min-h-screen bg-[#F4F6FA] flex font-sans text-slate-900">
      {toast&&<div className={`fixed top-5 right-5 z-[100] px-5 py-3.5 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-2.5 ${toast.type==="error"?"bg-red-600 text-white":"bg-emerald-600 text-white"}`}>{toast.type==="error"?"⚠️":"✅"} {toast.msg}</div>}
      <Sidebar tab={tab} setTab={(t)=>{setTab(t);setScreen("main");}} school={school}/>
      <main className="flex-1 overflow-y-auto h-screen">
        <div className="max-w-5xl mx-auto p-6 md:p-10">
          {loadingData?<div className="flex items-center justify-center h-64"><div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full"/></div>:<>
            {screen==="create"&&<CreateTest subjects={subjects} classes={classes} school={school} onSave={async(d)=>{const t=await handleSaveTest(d);if(t){setSelectedTest(t);setScreen("upload");}}} onCancel={()=>setScreen("main")} notify={notify}/>}
            {screen==="upload"&&<UploadScreen test={selectedTest} onComplete={(results)=>{handleSaveResults(selectedTest.id,results);setSelectedTest({...selectedTest,status:"採点完了"});setScreen("result");}} onBack={()=>setScreen("main")} notify={notify}/>}
            {screen==="result"&&<ResultScreen testId={selectedTest?.id} testMeta={tests.find(t=>t.id===selectedTest?.id)||selectedTest} notify={notify} onBack={()=>setScreen("main")}/>}
            {screen==="main"&&tab==="settings"&&<SettingsPage classes={classes} subjects={subjects} onSave={handleSaveSettings} notify={notify}/>}
            {screen==="main"&&tab!=="settings"&&<Dashboard tests={tests} tab={tab} onNew={()=>setScreen("create")} onSelect={(t)=>{setSelectedTest(t);setScreen(t.status==="未着手"?"upload":"result");}} onDelete={handleDeleteTest}/>}
          </>}
        </div>
      </main>
    </div>
  );
}

function LoginScreen({onLogin,toast}){
  const[id,setId]=useState("");const[pw,setPw]=useState("");const[loading,setLoading]=useState(false);
  const submit=async()=>{setLoading(true);await onLogin(id,pw);setLoading(false);};
  return(
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6">
      {toast&&<div className={`fixed top-5 right-5 z-50 px-5 py-3.5 rounded-2xl shadow-2xl font-bold text-sm ${toast.type==="error"?"bg-red-600 text-white":"bg-emerald-600 text-white"}`}>{toast.msg}</div>}
      <div className="relative bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-[3rem] p-12 w-full max-w-md shadow-2xl">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-blue-600 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 text-3xl">✦</div>
          <p className="text-blue-400 text-[10px] font-black uppercase tracking-[0.4em] mb-2">Ikedayama Shouten</p>
          <h1 className="text-3xl font-black text-white tracking-tight">AI一括採点システム</h1>
          <p className="text-slate-500 text-xs mt-2">Advanced Grading Engine 隼</p>
        </div>
        <div className="space-y-4">
          <input value={id} onChange={e=>setId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} className="w-full bg-white/5 border border-white/10 text-white rounded-2xl p-4 font-bold outline-none focus:border-blue-500 placeholder:text-slate-600" placeholder="学校コード"/>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} className="w-full bg-white/5 border border-white/10 text-white rounded-2xl p-4 font-bold outline-none focus:border-blue-500 placeholder:text-slate-600" placeholder="パスワード"/>
          <button onClick={submit} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white p-4 rounded-2xl font-black text-base shadow-xl transition-all active:scale-95">{loading?"認証中...":"ログイン"}</button>
        </div>
      </div>
    </div>
  );
}

function Sidebar({tab,setTab,school}){
  return(
    <aside className="w-56 bg-slate-900 flex flex-col shrink-0 h-screen sticky top-0">
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-2.5 mb-3"><div className="bg-blue-600 w-8 h-8 rounded-xl flex items-center justify-center text-white font-black text-sm">✦</div><div><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">AI採点</p><p className="text-white font-black text-sm">隼 Engine</p></div></div>
        {school&&<div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-slate-300 text-xs font-bold truncate">🏫 {school.name}</div>}
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {[{id:"dashboard",label:"ダッシュボード",icon:"▦"},{id:"analytics",label:"分析レポート",icon:"↗"},{id:"settings",label:"設定",icon:"⚙"}].map(item=>(
          <button key={item.id} onClick={()=>setTab(item.id)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${tab===item.id?"bg-blue-600 text-white shadow-lg":"text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}><span>{item.icon}</span>{item.label}</button>
        ))}
      </nav>
      <div className="p-3 space-y-2">
        <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold">🔒 APIキー隔離済み</div>
        <button onClick={()=>window.location.reload()} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black text-slate-500 hover:text-red-400 transition-all">ログアウト</button>
      </div>
    </aside>
  );
}

function Dashboard({tests,tab,onNew,onSelect,onDelete}){
  const[search,setSearch]=useState("");
  const[filterStatus,setFilterStatus]=useState("all");
  const[filterSubject,setFilterSubject]=useState("all");
  const[filterClass,setFilterClass]=useState("all");
  const[sortBy,setSortBy]=useState("date");

  const stats=useMemo(()=>({total:tests.length,done:tests.filter(t=>t.status==="採点完了").length,inProgress:tests.filter(t=>t.status==="採点中").length}),[tests]);

  // 科目・クラスの選択肢を動的生成
  const allSubjects=useMemo(()=>[...new Set(tests.map(t=>t.subject).filter(Boolean))],[tests]);
  const allClasses=useMemo(()=>[...new Set(tests.flatMap(t=>t.classes||[]).filter(Boolean))],[tests]);

  const filtered=useMemo(()=>{
    let arr=tests.filter(t=>{
      const matchSearch=t.name.toLowerCase().includes(search.toLowerCase())||(t.subject||"").includes(search);
      const matchStatus=filterStatus==="all"||t.status===filterStatus;
      const matchSubject=filterSubject==="all"||t.subject===filterSubject;
      const matchClass=filterClass==="all"||(t.classes||[]).includes(filterClass);
      return matchSearch&&matchStatus&&matchSubject&&matchClass;
    });
    if(sortBy==="name") arr=[...arr].sort((a,b)=>a.name.localeCompare(b.name,"ja"));
    else if(sortBy==="subject") arr=[...arr].sort((a,b)=>(a.subject||"").localeCompare(b.subject||"","ja"));
    else if(sortBy==="class") arr=[...arr].sort((a,b)=>(a.classes?.[0]||"").localeCompare(b.classes?.[0]||"","ja"));
    else if(sortBy==="status") arr=[...arr].sort((a,b)=>a.status.localeCompare(b.status,"ja"));
    else arr=[...arr].sort((a,b)=>b.date?.localeCompare(a.date||""));
    return arr;
  },[tests,search,filterStatus,filterSubject,filterClass,sortBy]);

  if(tab==="analytics") return <AnalyticsPage tests={tests}/>;
  return(
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div><h2 className="text-2xl font-black text-slate-800">ダッシュボード</h2><p className="text-slate-400 text-sm mt-1">テストの管理とAI採点の進捗確認</p></div>
        <button onClick={onNew} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-black text-sm shadow-lg flex items-center gap-2 transition-all active:scale-95">＋ 新規テスト作成</button>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-3 gap-4">
        {[{label:"総テスト数",value:stats.total},{label:"採点完了",value:stats.done},{label:"採点中",value:stats.inProgress}].map(s=>(<div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"><p className="text-3xl font-black text-slate-800">{s.value}</p><p className="text-xs text-slate-400 font-bold mt-1">{s.label}</p></div>))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* フィルターバー */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
          <div className="flex gap-2 flex-wrap items-center justify-between">
            <h3 className="font-black text-slate-700 text-sm">テスト一覧 <span className="text-slate-400 font-bold">({filtered.length}件)</span></h3>
            <button onClick={()=>setScreen("create")} className="hidden"/>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* 検索 */}
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="テスト名で検索..." className="pl-4 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-400 w-44"/>
            {/* 科目フィルター */}
            <select value={filterSubject} onChange={e=>setFilterSubject(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400">
              <option value="all">すべての教科</option>
              {allSubjects.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            {/* クラスフィルター */}
            <select value={filterClass} onChange={e=>setFilterClass(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400">
              <option value="all">すべてのクラス</option>
              {allClasses.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            {/* ステータスフィルター */}
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400">
              <option value="all">すべての状態</option>
              <option value="未着手">未着手</option>
              <option value="採点中">採点中</option>
              <option value="採点完了">採点完了</option>
            </select>
            {/* ソート */}
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400">
              <option value="date">日付順</option>
              <option value="class">クラス順</option>
              <option value="subject">教科順</option>
              <option value="name">テスト名順</option>
              <option value="status">ステータス順</option>
            </select>
            {/* リセット */}
            {(filterSubject!=="all"||filterClass!=="all"||filterStatus!=="all"||search)&&(
              <button onClick={()=>{setSearch("");setFilterSubject("all");setFilterClass("all");setFilterStatus("all");}} className="px-3 py-2 bg-red-50 text-red-500 border border-red-200 rounded-xl text-xs font-black hover:bg-red-100 transition-all">✕ リセット</button>
            )}
          </div>
        </div>

        {/* テーブル */}
        {filtered.length===0?<div className="py-20 text-center text-slate-300 font-black text-sm">条件に合うテストがありません</div>:(
          <table className="w-full">
            <thead><tr className="text-left border-b border-slate-50">{["テスト名","教科","クラス","ステータス","実施日",""].map(h=><th key={h} className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(t=>(
                <tr key={t.id} className="hover:bg-slate-50/80 cursor-pointer group transition-all" onClick={()=>onSelect(t)}>
                  <td className="px-5 py-4 font-bold text-slate-800 text-sm">{t.name}</td>
                  <td className="px-5 py-4"><span className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${SUBJECT_COLORS[t.subject]||"bg-slate-100 text-slate-500 border-slate-200"}`}>{t.subject}</span></td>
                  <td className="px-5 py-4 text-xs text-slate-500 font-bold">{(t.classes||[]).join(", ")}</td>
                  <td className="px-5 py-4"><span className={`flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-lg w-fit ${STATUS_CONFIG[t.status]?.color}`}><span className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[t.status]?.dot}`}/>{t.status}</span></td>
                  <td className="px-5 py-4 text-xs text-slate-400 font-bold">{t.date}</td>
                  <td className="px-5 py-4 text-right" onClick={e=>e.stopPropagation()}><button onClick={()=>{if(window.confirm("削除しますか？"))onDelete(t.id);}} className="p-2 text-slate-200 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50">🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CreateTest({subjects,classes,school,onSave,onCancel,notify}){
  const[info,setInfo]=useState({name:"",subject:subjects[0]||"国語",classes:[],date:new Date().toISOString().slice(0,10)});
  const[sections,setSections]=useState([{id:genId(),title:"大問1",questions:[{id:genId(),type:"essay",q:"",ans:"",criteria:"",pts:20,choices:[""]}]}]);
  const[errors,setErrors]=useState({});const[saving,setSaving]=useState(false);
  const[extracting,setExtracting]=useState(false);
  const pdfRef=useRef();
  const[templates,setTemplates]=useState([]);
  const[showTemplates,setShowTemplates]=useState(false);
  const[savingTemplate,setSavingTemplate]=useState(false);
  const[templateName,setTemplateName]=useState("");

  useEffect(()=>{ if(!school?.id) return; fetchTemplates(school.id).then(setTemplates).catch(()=>{}); },[school?.id]);

  const handleSaveTemplate=async()=>{
    if(!templateName.trim()){ notify("テンプレート名を入力してください","error"); return; }
    setSavingTemplate(true);
    try{ await saveTemplate(school.id,templateName,info.subject,sections); const updated=await fetchTemplates(school.id); setTemplates(updated); setTemplateName(""); notify("テンプレートを保存しました"); }
    catch(e){ notify(e.message,"error"); }
    finally{ setSavingTemplate(false); }
  };
  const handleLoadTemplate=(tmpl)=>{
    setInfo(prev=>({...prev,subject:tmpl.subject}));
    setSections(tmpl.sections.map(s=>({...s,id:genId(),questions:s.questions.map(q=>({...q,id:genId()}))})));
    setShowTemplates(false); notify(`「${tmpl.name}」を読み込みました`);
  };
  const handleDeleteTemplate=async(id,name)=>{
    if(!window.confirm(`「${name}」を削除しますか？`)) return;
    try{ await deleteTemplate(id); setTemplates(templates.filter(t=>t.id!==id)); notify("削除しました"); }
    catch(e){ notify(e.message,"error"); }
  };
  const validate=()=>{
    const e={};
    if(!info.name.trim()) e.name="テスト名を入力してください";
    if(!info.classes.length) e.classes="クラスを選択してください";
    sections.forEach((s,si)=>s.questions.forEach((q,qi)=>{ if(!q.q.trim()) e[`q${si}${qi}`]=true; if(q.type!=="word"&&!q.criteria.trim()) e[`c${si}${qi}`]=true; }));
    setErrors(e); return !Object.keys(e).length;
  };
  const totalPts=sections.reduce((s,sec)=>s+sec.questions.reduce((ss,q)=>ss+Number(q.pts||0),0),0);
  const handlePdfExtract=async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    setExtracting(true); notify("PDFを解析中...");
    try{
      const b64=await fileToBase64(file);
      const result=await callGeminiExtract(b64,file.type);
      if(result.sections&&result.sections.length>0){
        setSections(result.sections.map(s=>({id:genId(),title:s.title||"大問1",questions:(s.questions||[]).map(q=>({id:genId(),type:q.type||"essay",q:q.q||"",ans:q.ans||"",criteria:q.criteria||"",pts:q.pts||10,choices:q.choices||["","","",""]}))})));
        notify(`✅ ${result.sections.length}大問・${result.sections.reduce((s,sec)=>s+(sec.questions||[]).length,0)}問を自動生成しました`);
      }
    }catch(err){ notify("PDF解析エラー: "+err.message,"error"); }
    finally{ setExtracting(false); pdfRef.current.value=""; }
  };
  const moveSectionUp=(idx)=>setSections(s=>moveUp(s,idx));
  const moveSectionDown=(idx)=>setSections(s=>moveDown(s,idx));
  const copySection=(idx)=>{ const copied={...sections[idx],id:genId(),title:sections[idx].title+"（コピー）",questions:sections[idx].questions.map(q=>({...q,id:genId()}))}; const next=[...sections]; next.splice(idx+1,0,copied); setSections(next); };
  const removeSection=(idx)=>setSections(s=>s.filter((_,i)=>i!==idx));
  const updateSectionTitle=(idx,title)=>setSections(s=>s.map((sec,i)=>i===idx?{...sec,title}:sec));
  const updateQ=(sid,qid,field,val)=>setSections(s=>s.map(sec=>sec.id!==sid?sec:{...sec,questions:sec.questions.map(q=>q.id!==qid?q:{...q,[field]:val})}));
  const moveQUp=(sid,qIdx)=>setSections(s=>s.map(sec=>sec.id!==sid?sec:{...sec,questions:moveUp(sec.questions,qIdx)}));
  const moveQDown=(sid,qIdx)=>setSections(s=>s.map(sec=>sec.id!==sid?sec:{...sec,questions:moveDown(sec.questions,qIdx)}));
  const copyQ=(sid,qIdx)=>setSections(s=>s.map(sec=>{ if(sec.id!==sid) return sec; const copied={...sec.questions[qIdx],id:genId()}; const next=[...sec.questions]; next.splice(qIdx+1,0,copied); return{...sec,questions:next}; }));
  const removeQ=(sid,qid)=>setSections(s=>s.map(sec=>sec.id!==sid?sec:{...sec,questions:sec.questions.filter(q=>q.id!==qid)}));
  const addQ=(sid)=>setSections(s=>s.map(sec=>sec.id!==sid?sec:{...sec,questions:[...sec.questions,{id:genId(),type:"essay",q:"",ans:"",criteria:"",pts:10,choices:["",""]}]}));
  const getTypeBadge=(type)=>{ const t=QUESTION_TYPES.find(t=>t.value===type)||QUESTION_TYPES[0]; return <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${t.color}`}>{t.label}</span>; };

  return(
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center">
        <div><h2 className="text-2xl font-black text-slate-800">新規テスト作成</h2><p className="text-slate-400 text-sm mt-1">PDFから自動生成、↑↓で並び替え、⧉でコピー可能</p></div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="px-6 py-2.5 text-slate-400 font-bold hover:text-slate-600">キャンセル</button>
          <button onClick={async()=>{if(validate()){setSaving(true);await onSave({...info,sections});setSaving(false);}}} disabled={saving} className="bg-slate-900 hover:bg-blue-600 disabled:opacity-60 text-white px-8 py-2.5 rounded-xl font-black shadow-lg transition-all">{saving?"保存中...":"保存して採点へ →"}</button>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4">
          <div><p className="font-black text-slate-800">📋 テンプレート</p><p className="text-slate-400 text-xs mt-0.5">採点基準・設問構成を保存・再利用できます</p></div>
          <button onClick={()=>setShowTemplates(!showTemplates)} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-sm transition-all">
            📂 読み込む {templates.length>0&&<span className="ml-1 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">{templates.length}</span>}
          </button>
        </div>
        {showTemplates&&(
          <div className="border-t border-slate-100 p-6 space-y-3 bg-slate-50/50">
            {templates.length===0?<p className="text-slate-400 text-sm text-center py-4">保存済みのテンプレートがありません</p>:templates.map(tmpl=>(
              <div key={tmpl.id} className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                <div><p className="font-black text-slate-800 text-sm">{tmpl.name}</p><p className="text-xs text-slate-400 mt-0.5">{tmpl.subject} · {tmpl.sections?.length||0}大問 · {tmpl.sections?.reduce((s,sec)=>s+(sec.questions?.length||0),0)}問</p></div>
                <div className="flex gap-2">
                  <button onClick={()=>handleLoadTemplate(tmpl)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs transition-all">読み込む</button>
                  <button onClick={()=>handleDeleteTemplate(tmpl.id,tmpl.name)} className="px-3 py-2 text-slate-300 hover:text-red-500 transition-colors">🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-slate-100 px-6 py-4 flex gap-3 items-center bg-slate-50/30">
          <input value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="テンプレート名を入力して保存..." className="flex-1 bg-white border border-slate-200 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400" onKeyDown={e=>e.key==="Enter"&&handleSaveTemplate()}/>
          <button onClick={handleSaveTemplate} disabled={savingTemplate||!templateName.trim()} className="px-6 py-3 bg-slate-900 hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl font-black text-sm transition-all">{savingTemplate?"保存中...":"💾 保存"}</button>
        </div>
      </div>
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div><p className="font-black text-lg">📄 PDFから問題を自動生成</p><p className="text-blue-100 text-sm mt-1">試験問題のPDF・画像をアップロードすると、大問・設問・採点基準をAIが自動で作成します</p></div>
          <div>
            <button onClick={()=>pdfRef.current.click()} disabled={extracting} className="bg-white text-blue-600 px-6 py-3 rounded-xl font-black text-sm hover:bg-blue-50 disabled:opacity-60 transition-all shadow-lg flex items-center gap-2">{extracting?<><span className="animate-spin">⟳</span> 解析中...</>:<>📄 PDFをアップロード</>}</button>
            <input ref={pdfRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handlePdfExtract}/>
            <p className="text-blue-200 text-[10px] text-center mt-2">JPG・PNG・PDFに対応</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-2 space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">テスト名 *</label>
          <input value={info.name} onChange={e=>setInfo({...info,name:e.target.value})} className={`w-full bg-slate-50 border rounded-xl p-3 font-bold outline-none focus:ring-2 focus:ring-blue-400 ${errors.name?"border-red-300":"border-slate-100"}`} placeholder="例: 第2回英語小テスト"/>
          {errors.name&&<p className="text-red-500 text-xs font-bold">{errors.name}</p>}
        </div>
        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">教科</label><select value={info.subject} onChange={e=>setInfo({...info,subject:e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold outline-none focus:ring-2 focus:ring-blue-400">{subjects.map(s=><option key={s}>{s}</option>)}</select></div>
        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">実施日</label><input type="date" value={info.date} onChange={e=>setInfo({...info,date:e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 font-bold outline-none focus:ring-2 focus:ring-blue-400"/></div>
        <div className="lg:col-span-4 space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">対象クラス *</label>
          <div className="flex flex-wrap gap-2">{classes.map(c=><button key={c} onClick={()=>setInfo({...info,classes:info.classes.includes(c)?info.classes.filter(i=>i!==c):[...info.classes,c]})} className={`px-4 py-2 rounded-xl text-xs font-black border transition-all ${info.classes.includes(c)?"bg-blue-600 border-blue-600 text-white":"border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300"}`}>{c}</button>)}</div>
          {errors.classes&&<p className="text-red-500 text-xs font-bold">{errors.classes}</p>}
        </div>
      </div>
      <div className="flex justify-end"><div className={`px-5 py-2.5 rounded-xl font-black text-sm border ${totalPts===100?"bg-emerald-50 text-emerald-700 border-emerald-200":"bg-amber-50 text-amber-700 border-amber-200"}`}>合計配点: {totalPts}点 {totalPts!==100&&"← 100点推奨"}</div></div>
      {sections.map((s,si)=>(
        <div key={s.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 bg-slate-50/50 border-b border-slate-100">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-sm shrink-0">{si+1}</div>
              <input value={s.title} onChange={e=>updateSectionTitle(si,e.target.value)} className="font-black text-lg bg-transparent outline-none focus:bg-white focus:border focus:border-slate-200 px-3 py-1.5 rounded-xl transition-all flex-1" placeholder="大問タイトルを入力"/>
            </div>
            <div className="flex items-center gap-1 ml-4">
              <button onClick={()=>moveSectionUp(si)} disabled={si===0} title="上へ" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-20 transition-all font-black text-sm">↑</button>
              <button onClick={()=>moveSectionDown(si)} disabled={si===sections.length-1} title="下へ" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-20 transition-all font-black text-sm">↓</button>
              <button onClick={()=>copySection(si)} title="コピー" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all text-sm">⧉</button>
              {sections.length>1&&<button onClick={()=>removeSection(si)} title="削除" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all text-sm">🗑</button>}
            </div>
          </div>
          <div className="p-6 space-y-4">
            {s.questions.map((q,qi)=>(
              <div key={q.id} className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-white/60">
                  <div className="flex items-center gap-3"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">設問 {qi+1}</span>{getTypeBadge(q.type)}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={()=>moveQUp(s.id,qi)} disabled={qi===0} title="上へ" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-20 transition-all text-xs font-black">↑</button>
                    <button onClick={()=>moveQDown(s.id,qi)} disabled={qi===s.questions.length-1} title="下へ" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-20 transition-all text-xs font-black">↓</button>
                    <button onClick={()=>copyQ(s.id,qi)} title="コピー" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 transition-all text-xs">⧉</button>
                    {s.questions.length>1&&<button onClick={()=>removeQ(s.id,q.id)} title="削除" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all text-xs">✕</button>}
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase">問題の種類</label>
                    <div className="flex gap-2 flex-wrap">{QUESTION_TYPES.map(t=>(<button key={t.value} onClick={()=>updateQ(s.id,q.id,"type",t.value)} className={`px-4 py-2 rounded-xl text-xs font-black border transition-all ${q.type===t.value?t.color+" border-current shadow-sm":"border-slate-200 bg-white text-slate-400 hover:border-slate-300"}`}>{t.label} <span className="font-medium opacity-70">— {t.desc}</span></button>))}</div>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="col-span-3 space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase">問題内容 *</label><textarea rows={2} value={q.q} onChange={e=>updateQ(s.id,q.id,"q",e.target.value)} className={`w-full bg-white border rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-400 resize-none ${errors[`q${si}${qi}`]?"border-red-300":"border-slate-100"}`} placeholder="問題文を入力してください"/></div>
                    <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase">配点</label><div className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl px-3 py-3"><input type="number" value={q.pts} onChange={e=>updateQ(s.id,q.id,"pts",e.target.value)} className="w-12 font-black text-xl text-center outline-none text-slate-800" min={0}/><span className="text-slate-400 font-bold text-sm">点</span></div></div>
                  </div>
                  {q.type==="choice"&&(
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase">選択肢</label>
                      <div className="grid grid-cols-2 gap-2">{(q.choices||["",""]).map((c,ci)=>(<div key={ci} className="flex items-center gap-2"><span className="w-6 h-6 bg-slate-200 rounded-lg flex items-center justify-center text-[10px] font-black text-slate-600 shrink-0">{String.fromCharCode(65+ci)}</span><input value={c} onChange={e=>{ const nc=[...(q.choices||[])]; nc[ci]=e.target.value; updateQ(s.id,q.id,"choices",nc); }} className="flex-1 bg-white border border-slate-100 rounded-xl p-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-400" placeholder={`選択肢${String.fromCharCode(65+ci)}`}/></div>))}</div>
                      <button onClick={()=>updateQ(s.id,q.id,"choices",[...(q.choices||[]),""])} className="text-[10px] font-black text-blue-500 hover:text-blue-700">＋ 選択肢を追加</button>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase">{q.type==="word"?"正解（完全一致）":q.type==="choice"?"正解の記号（例: A）":"模範解答（任意）"}</label>
                    <input value={q.ans} onChange={e=>updateQ(s.id,q.id,"ans",e.target.value)} className="w-full bg-white border border-slate-100 rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-400" placeholder={q.type==="word"?"例: 光合成":q.type==="choice"?"例: A":"模範解答・正解例"}/>
                  </div>
                  {q.type!=="word"&&(<div className="space-y-1.5"><label className="text-[10px] font-black text-blue-600 uppercase tracking-widest">✦ AI採点プロンプト・採点基準 *</label><textarea rows={2} value={q.criteria} onChange={e=>updateQ(s.id,q.id,"criteria",e.target.value)} className={`w-full bg-blue-50/50 border rounded-xl p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-400 resize-none ${errors[`c${si}${qi}`]?"border-red-300":"border-blue-100"}`} placeholder={q.type==="choice"?"例: 正解はA。":"例: キーワード「産業革命」が含まれていれば10点。"}/></div>)}
                  {q.type==="word"&&<div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700 font-bold">✅ 単語・記号は正解と完全一致した場合に自動で満点、不一致で0点になります。</div>}
                </div>
              </div>
            ))}
            <button onClick={()=>addQ(s.id)} className="w-full py-4 rounded-xl border-2 border-dashed border-slate-200 text-slate-300 font-black text-xs hover:border-blue-300 hover:text-blue-400 transition-all">＋ 設問を追加</button>
          </div>
        </div>
      ))}
      <button onClick={()=>setSections([...sections,{id:genId(),title:`大問${sections.length+1}`,questions:[{id:genId(),type:"essay",q:"",ans:"",criteria:"",pts:10,choices:[""]}]}])} className="w-full py-8 rounded-2xl border-2 border-dashed border-blue-100 bg-blue-50/30 text-blue-300 font-black flex flex-col items-center gap-3 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-500 transition-all"><span className="text-2xl">＋</span><span className="text-sm">大問セクションを追加</span></button>
    </div>
  );
}

function UploadScreen({test,onComplete,onBack,notify}){
  const[files,setFiles]=useState([]);const[running,setRunning]=useState(false);
  const[progress,setProgress]=useState({cur:0,total:0,status:""});const[results,setResults]=useState([]);
  const fileRef=useRef();
  const handleFiles=(e)=>setFiles(prev=>[...prev,...Array.from(e.target.files).filter(f=>f.type.startsWith("image/")||f.type==="application/pdf")]);
  const startGrading=async()=>{
    if(!files.length){ notify("答案ファイルをアップロードしてください","error"); return; }
    if(!test?.sections?.length){ notify("採点基準が設定されていません","error"); return; }
    setRunning(true); const all=[];
    for(let i=0;i<files.length;i++){
      const file=files[i];
      setProgress({cur:i+1,total:files.length,status:`${file.name} を採点中...`});
      try{
        const b64=await fileToBase64(file);
        if(file.type==="application/pdf"){
          // PDFを1ページずつ画像に変換して採点
          try{
            const pages = await pdfToImages(file);
            for(let p=0;p<pages.length;p++){
              setProgress({cur:i+1,total:files.length,status:`${file.name} (${p+1}/${pages.length}ページ) を採点中...`});
              try{
                const result=await callGemini(pages[p],"image/jpeg",test.sections);
                all.push({...result,fileName:`${file.name} (${p+1}ページ目)`});
              }catch(err){
                all.push({student_name:`エラー(${file.name} ${p+1}ページ目)`,results:[],total_score:0,overall_comment:err.message,fileName:`${file.name} (${p+1}ページ目)`,error:true});
              }
            }
          }catch(err){
            all.push({student_name:`エラー(${file.name})`,results:[],total_score:0,overall_comment:err.message,fileName:file.name,error:true});
          }
        } else {
          const result=await callGemini(b64,file.type,test.sections);
          all.push({...result,fileName:file.name});
        }
      }catch(err){
        all.push({student_name:`エラー(${file.name})`,results:[],total_score:0,overall_comment:err.message,fileName:file.name,error:true});
      }
    }
    setResults(all);setRunning(false);
  };
  if(running||results.length>0) return(
    <div className="space-y-6">
      <h2 className="text-2xl font-black text-slate-800">{test?.name} — AI採点</h2>
      {running?(
        <div className="bg-white rounded-2xl p-16 shadow-sm border border-slate-100 flex flex-col items-center gap-8">
          <div className="relative w-32 h-32"><div className="absolute inset-0 border-4 border-slate-100 rounded-full"/><div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"/><div className="absolute inset-0 flex items-center justify-center font-black text-2xl text-slate-800">{progress.cur}/{progress.total}</div></div>
          <div className="text-center"><p className="font-black text-slate-800">{progress.status}</p><p className="text-slate-400 text-sm mt-1">Gemini 2.5 Flash が答案を解析中...</p></div>
          <div className="w-full max-w-md bg-slate-100 rounded-full h-3 overflow-hidden"><div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{width:`${(progress.cur/progress.total)*100}%`}}/></div>
        </div>
      ):(
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center gap-4"><span className="text-2xl">✅</span><div><p className="font-black text-emerald-800">{results.length}件の採点が完了しました</p><p className="text-emerald-600 text-sm">「保存」を押すとSupabaseのDBに記録されます</p></div></div>
          {results.map((r,i)=>(<div key={i} className={`bg-white rounded-2xl p-5 shadow-sm border ${r.error?"border-red-200":"border-slate-100"}`}><div className="flex justify-between items-center mb-2"><div><p className="font-black text-slate-800">{r.student_name||"（氏名読取失敗）"}</p><p className="text-xs text-slate-400">{r.fileName}</p></div><span className={`text-3xl font-black ${r.error?"text-red-500":"text-slate-900"}`}>{r.total_score??"-"}<span className="text-slate-400 text-sm font-bold">点</span></span></div>{r.overall_comment&&<p className="text-sm text-slate-500 italic border-t border-slate-50 pt-2">{r.overall_comment}</p>}</div>))}
          <button onClick={()=>onComplete(results)} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black text-base shadow-lg transition-all active:scale-95">採点結果をDBに保存して詳細へ →</button>
        </div>
      )}
    </div>
  );
  return(
    <div className="space-y-6 pb-20">
      <div className="flex justify-between items-center"><div><h2 className="text-2xl font-black text-slate-800">{test?.name}</h2><p className="text-slate-400 text-sm mt-1">答案をアップロードしてAI採点を開始（PDF=1ページ1生徒）</p></div><button onClick={onBack} className="text-slate-400 font-bold hover:text-slate-600 px-4 py-2">← 戻る</button></div>
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-700 font-bold">📋 PDFの場合：1ページ=1生徒として全員を一括採点します。画像の場合：1ファイル=1生徒として採点します。</div>
      <div onDrop={e=>{e.preventDefault();setFiles(prev=>[...prev,...Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith("image/")||f.type==="application/pdf")]);}} onDragOver={e=>e.preventDefault()} onClick={()=>fileRef.current.click()} className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-white hover:bg-blue-50/30 rounded-2xl p-16 flex flex-col items-center gap-4 cursor-pointer transition-all group">
        <div className="w-16 h-16 bg-slate-50 group-hover:bg-blue-100 rounded-2xl flex items-center justify-center text-4xl transition-all">📄</div>
        <div className="text-center"><p className="font-black text-slate-600 group-hover:text-blue-700">クリックまたはドラッグ＆ドロップ</p><p className="text-slate-400 text-sm mt-1">JPG, PNG, PDF（複数可）</p></div>
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleFiles}/>
      </div>
      {files.length>0&&(<div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"><div className="px-5 py-4 border-b border-slate-50 flex justify-between items-center"><span className="font-black text-slate-700 text-sm">{files.length}件選択中</span><button onClick={()=>setFiles([])} className="text-xs text-slate-400 hover:text-red-500 font-bold">すべて削除</button></div><div className="divide-y divide-slate-50 max-h-48 overflow-y-auto">{files.map((f,i)=>(<div key={i} className="flex items-center justify-between px-5 py-3"><div className="flex items-center gap-3"><span>{f.type==="application/pdf"?"📄":"📷"}</span><span className="text-sm font-medium text-slate-700">{f.name}</span><span className="text-xs text-slate-400">{(f.size/1024).toFixed(0)}KB</span></div><button onClick={()=>setFiles(files.filter((_,fi)=>fi!==i))} className="text-slate-300 hover:text-red-500">✕</button></div>))}</div></div>)}
      <button onClick={startGrading} disabled={files.length===0} className="w-full bg-slate-900 hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 text-white py-5 rounded-xl font-black text-lg shadow-2xl transition-all active:scale-95">✦ {files.length>0?`${files.length}件の答案をAI採点開始`:"答案ファイルをアップロードしてください"}</button>
    </div>
  );
}

function ResultScreen({testId,testMeta,notify,onBack}){
  const[results,setResults]=useState([]);const[loading,setLoading]=useState(true);
  const[selected,setSelected]=useState(null);const[editScore,setEditScore]=useState(null);
  const[studentInfo,setStudentInfo]=useState({});
  const updateStudentInfo=(id,field,val)=>setStudentInfo(prev=>({...prev,[id]:{...(prev[id]||{}),[field]:val}}));
  useEffect(()=>{
    if(!testId) return;
    supabase.from("grading_results").select("*").eq("test_id",testId).order("graded_at",{ascending:false}).then(({data,error})=>{if(!error)setResults(data||[]);}).finally(()=>setLoading(false));
  },[testId]);
  const maxTotal=useMemo(()=>{ if(!testMeta?.sections) return 100; return testMeta.sections.reduce((s,sec)=>s+sec.questions.reduce((ss,q)=>ss+Number(q.pts||0),0),0); },[testMeta]);
  const avg=results.length>0?Math.round(results.reduce((s,r)=>s+(r.total_score||0),0)/results.length):0;
  const handleAdjust=async()=>{
    const{error}=await supabase.from("grading_results").update({total_score:editScore,manually_adjusted:true}).eq("id",selected.id);
    if(error){ notify(error.message,"error"); return; }
    setResults(results.map(r=>r.id===selected.id?{...r,total_score:editScore,manually_adjusted:true}:r));
    notify("スコアを修正しました");setSelected(null);
  };
  const exportCSV=()=>{
    const qHeaders=[];
    (testMeta?.sections||[]).forEach(sec=>{ (sec.questions||[]).forEach((q,qi)=>{ qHeaders.push(`${sec.title}-設問${qi+1}(${q.pts}点満点)`); }); });
    const headers=["学年","クラス","出席番号","氏名","合計点","手動修正",...qHeaders,"総合コメント","採点日時"];
    const rows=[headers];
    results.forEach(r=>{
      const info=studentInfo[r.id]||{};
      const qScores=[];
      (testMeta?.sections||[]).forEach(sec=>{ (sec.questions||[]).forEach((_,qi)=>{ const found=(r.results||[]).find(res=>res.section===sec.title&&res.q_idx===qi); qScores.push(found?found.score:""); }); });
      rows.push([info.grade||"",info.classname||"",info.number||"",r.student_name,r.total_score,r.manually_adjusted?"あり":"なし",...qScores,r.overall_comment||"",r.graded_at]);
    });
    const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,"\"\"")}`).join(",")).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${testMeta?.name}_採点結果.csv`;a.click();
  };
  return(
    <div className="space-y-6 pb-20">
      <div className="flex items-end justify-between">
        <div><h2 className="text-2xl font-black text-slate-800">{testMeta?.name} — 採点結果</h2><div className="flex items-center gap-2 mt-1"><span className={`text-[10px] font-black px-2 py-1 rounded-lg border ${SUBJECT_COLORS[testMeta?.subject]||"bg-slate-100 text-slate-500 border-slate-200"}`}>{testMeta?.subject}</span>{testMeta?.classes?.map(c=><span key={c} className="text-xs text-slate-400 font-bold">{c}</span>)}</div></div>
        <div className="flex gap-3"><button onClick={exportCSV} className="flex items-center gap-2 bg-white border border-slate-200 px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 hover:border-blue-400 transition-all shadow-sm">📥 CSV出力</button><button onClick={onBack} className="text-slate-400 font-bold hover:text-slate-600 px-4 py-2">← 戻る</button></div>
      </div>
      <div className="grid grid-cols-3 gap-4">{[{label:"採点人数",value:results.length+"名"},{label:"クラス平均",value:avg+"点"},{label:"満点",value:maxTotal+"点"}].map(s=>(<div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"><p className="text-2xl font-black text-slate-800">{s.value}</p><p className="text-xs text-slate-400 font-bold mt-1">{s.label}</p></div>))}</div>
      {loading?<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"/></div>:results.length===0?<div className="bg-white rounded-2xl p-20 text-center shadow-sm border border-slate-100"><p className="text-slate-300 font-black">採点データがありません</p></div>:(
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead><tr className="text-left border-b border-slate-100 bg-slate-50/50">{["#","学年","クラス","出席番号","氏名","合計点","手動修正","操作"].map(h=><th key={h} className="px-4 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-50">
                {results.map((r,i)=>{
                  const info=studentInfo[r.id]||{};
                  return(
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-all">
                      <td className="px-4 py-3 text-xs font-black text-slate-300">{i+1}</td>
                      <td className="px-4 py-3"><input value={info.grade||""} onChange={e=>updateStudentInfo(r.id,"grade",e.target.value)} className="w-14 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400" placeholder="3年"/></td>
                      <td className="px-4 py-3"><input value={info.classname||""} onChange={e=>updateStudentInfo(r.id,"classname",e.target.value)} className="w-16 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400" placeholder="A組"/></td>
                      <td className="px-4 py-3"><input type="number" value={info.number||""} onChange={e=>updateStudentInfo(r.id,"number",e.target.value)} className="w-14 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-400" placeholder="1"/></td>
                      <td className="px-4 py-3 font-bold text-slate-800 text-sm whitespace-nowrap">{r.student_name}</td>
                      <td className="px-4 py-3"><span className="text-2xl font-black text-slate-900">{r.total_score}</span><span className="text-slate-400 text-sm font-bold">/{maxTotal}</span></td>
                      <td className="px-4 py-3">{r.manually_adjusted&&<span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-1 rounded-lg">修正済み</span>}</td>
                      <td className="px-4 py-3"><button onClick={()=>{setSelected(r);setEditScore(r.total_score);}} className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-blue-600 transition-all whitespace-nowrap">詳細・修正</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selected&&(
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-start"><div><h3 className="text-2xl font-black text-slate-900">{selected.student_name}</h3><p className="text-blue-600 text-xs font-black uppercase tracking-widest mt-1">AI採点詳細レポート</p></div><button onClick={()=>setSelected(null)} className="p-2 hover:bg-slate-100 rounded-xl text-xl">✕</button></div>
            <div className="p-8 max-h-[45vh] overflow-y-auto space-y-3">
              {(selected.results||[]).map((r,i)=>(<div key={i} className="bg-slate-50 rounded-2xl p-5 border border-slate-100"><div className="flex justify-between items-center mb-2"><span className="text-[10px] font-black text-slate-400 uppercase">{r.section} · 設問{(r.q_idx||0)+1}</span><span className={`font-black text-lg ${r.score>=r.max_score?"text-emerald-600":r.score>0?"text-amber-600":"text-red-500"}`}>{r.score}<span className="text-slate-400 text-sm font-bold">/{r.max_score}</span></span></div><p className="text-sm text-slate-500 font-medium leading-relaxed">{r.feedback}</p></div>))}
              {selected.overall_comment&&(<div className="bg-blue-50 rounded-2xl p-5 border border-blue-100"><p className="text-[10px] font-black text-blue-600 uppercase mb-2">総合コメント</p><p className="text-sm text-slate-600">{selected.overall_comment}</p></div>)}
            </div>
            <div className="p-8 border-t border-slate-100 bg-amber-50/50"><p className="text-xs font-bold text-amber-700 mb-3">スコアを手動修正（Supabaseに上書き保存されます）</p><div className="flex gap-4 items-end"><div><label className="text-[10px] font-black text-slate-400 uppercase">最終スコア</label><input type="number" value={editScore} onChange={e=>setEditScore(Number(e.target.value))} min={0} max={maxTotal} className="block bg-white border-2 border-amber-200 rounded-xl p-3 text-2xl font-black w-28 text-center mt-1 outline-none focus:ring-4 focus:ring-amber-200"/></div><button onClick={handleAdjust} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-4 rounded-xl font-black shadow-lg transition-all active:scale-95">修正してDBに保存</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalyticsPage({tests}){
  const[selectedTestId,setSelectedTestId]=useState("");
  const[results,setResults]=useState([]);
  const[loading,setLoading]=useState(false);
  const done=tests.filter(t=>t.status==="採点完了");

  useEffect(()=>{
    if(!selectedTestId) return;
    setLoading(true);
    supabase.from("grading_results").select("*").eq("test_id",selectedTestId)
      .then(({data})=>setResults(data||[]))
      .finally(()=>setLoading(false));
  },[selectedTestId]);

  const selectedTest=tests.find(t=>t.id===selectedTestId);
  const scores=results.map(r=>r.total_score||0);
  const avg=scores.length>0?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  const max=scores.length>0?Math.max(...scores):0;
  const min=scores.length>0?Math.min(...scores):0;
  const maxTotal=useMemo(()=>{
    if(!selectedTest?.sections) return 100;
    return selectedTest.sections.reduce((s,sec)=>s+sec.questions.reduce((ss,q)=>ss+Number(q.pts||0),0),0);
  },[selectedTest]);

  const distribution=useMemo(()=>{
    if(!scores.length||!maxTotal) return [];
    const buckets=[];
    const step=10;
    for(let i=0;i<=maxTotal;i+=step){
      const count=scores.filter(s=>s>=i&&s<i+step).length;
      buckets.push({label:`${i}〜${Math.min(i+step-1,maxTotal)}`,count,from:i});
    }
    return buckets;
  },[scores,maxTotal]);

  const questionStats=useMemo(()=>{
    if(!selectedTest?.sections||!results.length) return [];
    const stats=[];
    selectedTest.sections.forEach(sec=>{
      sec.questions.forEach((q,qi)=>{
        const qResults=results.map(r=>(r.results||[]).find(res=>res.section===sec.title&&res.q_idx===qi)).filter(Boolean);
        const avgScore=qResults.length>0?Math.round(qResults.reduce((s,r)=>s+(r.score||0),0)/qResults.length*10)/10:0;
        const rate=q.pts>0?Math.round(avgScore/q.pts*100):0;
        stats.push({label:`${sec.title}-設問${qi+1}`,avgScore,maxScore:q.pts,rate,type:q.type});
      });
    });
    return stats;
  },[selectedTest,results]);

  return(
    <div className="space-y-6">
      <h2 className="text-2xl font-black text-slate-800">分析レポート</h2>

      <div className="grid grid-cols-3 gap-4">
        {[{label:"完了テスト数",value:done.length+"件"},{label:"総テスト数",value:tests.length+"件"},{label:"完了率",value:tests.length>0?Math.round(done.length/tests.length*100)+"%":"-"}].map(s=>(<div key={s.label} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100"><p className="text-3xl font-black text-slate-800">{s.value}</p><p className="text-xs text-slate-400 font-bold mt-1">{s.label}</p></div>))}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">分析するテストを選択</label>
        <select value={selectedTestId} onChange={e=>setSelectedTestId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">テストを選んでください...</option>
          {done.map(t=><option key={t.id} value={t.id}>{t.name}（{t.subject} · {t.date}）</option>)}
        </select>
      </div>

      {selectedTestId&&(
        loading
          ?<div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"/></div>
          :results.length===0
            ?<div className="bg-white rounded-2xl p-20 text-center shadow-sm border border-slate-100"><p className="text-slate-300 font-black">採点データがありません</p></div>
            :<div className="space-y-6">

              {/* 基本統計 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {label:"採点人数",value:results.length+"名",color:"text-blue-600",bg:"bg-blue-50"},
                  {label:"クラス平均",value:avg+"点",color:"text-emerald-600",bg:"bg-emerald-50"},
                  {label:"最高点",value:max+"点",color:"text-purple-600",bg:"bg-purple-50"},
                  {label:"最低点",value:min+"点",color:"text-rose-600",bg:"bg-rose-50"},
                ].map(s=>(<div key={s.label} className={`${s.bg} rounded-2xl p-5 border border-slate-100`}><p className={`text-3xl font-black ${s.color}`}>{s.value}</p><p className="text-xs text-slate-500 font-bold mt-1">{s.label}</p></div>))}
              </div>

              {/* 得点分布グラフ */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-black text-slate-800">📊 得点分布</h3>
                  <div className="flex gap-4 text-xs font-bold text-slate-400">
                    <span>平均 <span className="text-emerald-600 font-black">{avg}点</span></span>
                    <span>満点 <span className="text-slate-600 font-black">{maxTotal}点</span></span>
                    <span>正答率 <span className="text-blue-600 font-black">{maxTotal>0?Math.round(avg/maxTotal*100):0}%</span></span>
                  </div>
                </div>
                <div className="flex items-end gap-1.5 h-40 mb-2">
                  {distribution.map((b,i)=>{
                    const maxCount=Math.max(...distribution.map(d=>d.count),1);
                    const height=b.count>0?Math.max((b.count/maxCount)*100,6):2;
                    const isAvgBucket=avg>=b.from&&avg<b.from+10;
                    return(
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        {b.count>0&&<span className="text-[10px] font-black text-slate-600">{b.count}人</span>}
                        <div className="w-full rounded-t-lg transition-all" style={{
                          height:`${height}%`,
                          backgroundColor:isAvgBucket?"#10b981":b.count>0?"#3b82f6":"#e2e8f0"
                        }}/>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1.5 mt-1">
                  {distribution.map((b,i)=>(
                    <div key={i} className="flex-1 text-center">
                      <span className="text-[8px] text-slate-400 font-bold">{b.from}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-4 text-[10px] font-bold">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500 rounded inline-block"/>平均点帯</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded inline-block"/>その他</span>
                </div>
              </div>

              {/* 設問ごとの正答率 */}
              {questionStats.length>0&&(
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                  <h3 className="font-black text-slate-800 mb-5">📝 設問ごとの平均得点・正答率</h3>
                  <div className="space-y-4">
                    {questionStats.map((q,i)=>(
                      <div key={i} className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">{q.label}</span>
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${q.type==="word"?"bg-emerald-100 text-emerald-700":q.type==="choice"?"bg-purple-100 text-purple-700":"bg-blue-100 text-blue-700"}`}>
                              {q.type==="word"?"単語":q.type==="choice"?"選択肢":"記述"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs font-bold">
                            <span className="text-slate-400">平均 {q.avgScore}/{q.maxScore}点</span>
                            <span className={`font-black text-sm ${q.rate>=80?"text-emerald-600":q.rate>=60?"text-amber-600":"text-red-500"}`}>{q.rate}%</span>
                          </div>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{
                            width:`${q.rate}%`,
                            backgroundColor:q.rate>=80?"#10b981":q.rate>=60?"#f59e0b":"#ef4444"
                          }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex gap-4 text-[10px] font-bold text-slate-400">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500 rounded-full inline-block"/>80%以上（A）</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-500 rounded-full inline-block"/>60〜79%（B）</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded-full inline-block"/>60%未満（C）</span>
                  </div>
                </div>
              )}

              {/* 採点者一覧 */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-black text-slate-800 text-sm">👥 生徒別得点一覧</h3>
                </div>
                <table className="w-full">
                  <thead><tr className="text-left border-b border-slate-50">{["順位","氏名","得点","平均との差","評価"].map(h=><th key={h} className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {[...results].sort((a,b)=>(b.total_score||0)-(a.total_score||0)).map((r,i)=>{
                      const diff=(r.total_score||0)-avg;
                      return(
                        <tr key={r.id} className="hover:bg-slate-50/80 transition-all">
                          <td className="px-5 py-3 font-black text-slate-400 text-sm">{i+1}位</td>
                          <td className="px-5 py-3 font-bold text-slate-800">{r.student_name}</td>
                          <td className="px-5 py-3"><span className="text-xl font-black text-slate-900">{r.total_score}</span><span className="text-slate-400 text-xs font-bold">/{maxTotal}</span></td>
                          <td className="px-5 py-3"><span className={`text-sm font-black ${diff>0?"text-emerald-600":diff<0?"text-red-500":"text-slate-400"}`}>{diff>0?"+":""}{diff}点</span></td>
                          <td className="px-5 py-3">
                            <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${
                              (r.total_score||0)/maxTotal>=0.8?"bg-emerald-100 text-emerald-700":
                              (r.total_score||0)/maxTotal>=0.6?"bg-amber-100 text-amber-700":
                              "bg-red-100 text-red-700"
                            }`}>
                              {(r.total_score||0)/maxTotal>=0.8?"A":(r.total_score||0)/maxTotal>=0.6?"B":"C"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
      )}

      {!selectedTestId&&done.length>0&&(
        <div className="space-y-3">
          <h3 className="font-black text-slate-700 text-sm">採点完了テスト一覧</h3>
          {done.map(t=>(<div key={t.id} onClick={()=>setSelectedTestId(t.id)} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group"><div className="flex justify-between items-center"><div><p className="font-black text-slate-800">{t.name}</p><p className="text-xs text-slate-400 font-bold mt-0.5">{t.subject} · {(t.classes||[]).join(", ")} · {t.date}</p></div><span className="text-blue-500 text-xs font-black group-hover:underline">分析する →</span></div></div>))}
        </div>
      )}

      {!selectedTestId&&done.length===0&&(
        <div className="bg-white rounded-2xl p-20 text-center shadow-sm border border-slate-100">
          <p className="text-slate-300 font-black text-lg mb-2">📊</p>
          <p className="text-slate-300 font-black">採点完了のテストがありません</p>
          <p className="text-slate-300 text-sm mt-1">テストを採点すると分析データが表示されます</p>
        </div>
      )}
    </div>
  );
}
function SettingsPage({classes,subjects,onSave,notify}){
  const[newCls,setNewCls]=useState("");const[newSub,setNewSub]=useState("");const[saving,setSaving]=useState(false);
  const save=async(c,s)=>{setSaving(true);await onSave(c,s);setSaving(false);};
  return(
    <div className="space-y-8">
      <h2 className="text-2xl font-black text-slate-800">設定</h2>
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
        <p className="font-black text-emerald-800">🔒 セキュリティ設定済み</p>
        <p className="text-emerald-700 text-sm mt-1">Gemini APIキーはSupabase Edge Functionsに安全に隔離されています。パスワードはbcryptでハッシュ化されています。</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 space-y-5">
          <h3 className="font-black text-slate-800">📚 教科・科目設定</h3>
          <div className="flex gap-2"><input value={newSub} onChange={e=>setNewSub(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newSub){save(classes,[...subjects,newSub]);setNewSub("");}}} className="flex-1 bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400" placeholder="例: 英語演習"/><button disabled={saving} onClick={()=>{if(newSub){save(classes,[...subjects,newSub]);setNewSub("");}}} className="bg-slate-900 text-white px-5 rounded-xl font-black text-sm hover:bg-blue-600 disabled:opacity-60 transition-all">追加</button></div>
          <div className="space-y-2 max-h-56 overflow-y-auto">{subjects.map(s=>(<div key={s} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100"><span className="font-bold text-sm text-slate-700">{s}</span><button disabled={saving} onClick={()=>save(classes,subjects.filter(i=>i!==s))} className="text-slate-300 hover:text-red-500 transition-colors">🗑</button></div>))}</div>
        </div>
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 space-y-5">
          <h3 className="font-black text-slate-800">🏫 クラス設定</h3>
          <div className="flex gap-2"><input value={newCls} onChange={e=>setNewCls(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newCls){save([...classes,newCls],subjects);setNewCls("");}}} className="flex-1 bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400" placeholder="例: 2年C組"/><button disabled={saving} onClick={()=>{if(newCls){save([...classes,newCls],subjects);setNewCls("");}}} className="bg-slate-900 text-white px-5 rounded-xl font-black text-sm hover:bg-blue-600 disabled:opacity-60 transition-all">追加</button></div>
          <div className="space-y-2 max-h-56 overflow-y-auto">{classes.map(c=>(<div key={c} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100"><span className="font-bold text-sm text-slate-700">{c}</span><button disabled={saving} onClick={()=>save(classes.filter(i=>i!==c),subjects)} className="text-slate-300 hover:text-red-500 transition-colors">🗑</button></div>))}</div>
        </div>
      </div>
    </div>
  );
}
