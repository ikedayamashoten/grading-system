"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://tcatrrncukiipogccdnc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjYXRycm5jdWtpaXBvZ2NjZG5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzA5ODcsImV4cCI6MjA4OTc0Njk4N30.pbcdWibNAI4r9UmJ4bsale_Lc11HusUH-cSoeAobfZQ"
);

export default function AdminPage() {
  const [screen, setScreen] = useState("login");
  const [admin, setAdmin] = useState(null);
  const [schools, setSchools] = useState([]);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const notify = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadSchools = async () => {
    const { data } = await supabase
      .from("schools")
      .select("id, name, code, created_at")
      .order("created_at", { ascending: false });
    setSchools(data || []);
  };

  useEffect(() => {
    if (admin) loadSchools();
  }, [admin]);

  const handleLogin = async (email, password) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("verify_admin_login", {
      p_email: email,
      p_password: password,
    });
    setLoading(false);
    if (error || !data?.length) { notify("メールアドレスまたはパスワードが違います", "error"); return; }
    setAdmin(data[0]);
    setScreen("dashboard");
  };

  const handleCreateSchool = async (name, code, password) => {
    if (!name || !code || !password) { notify("すべての項目を入力してください", "error"); return; }
    setLoading(true);
    const { error } = await supabase.rpc("create_school", {
      p_name: name, p_code: code, p_password: password,
    });
    setLoading(false);
    if (error) { notify(error.message, "error"); return; }
    notify(`「${name}」を追加しました`);
    loadSchools();
  };

  const handleDeleteSchool = async (id, name) => {
    if (!window.confirm(`「${name}」を削除しますか？\n※この学校のテスト・採点データもすべて削除されます`)) return;
    setLoading(true);
    const { error } = await supabase.from("schools").delete().eq("id", id);
    setLoading(false);
    if (error) { notify(error.message, "error"); return; }
    notify(`「${name}」を削除しました`);
    loadSchools();
  };

  if (screen === "login") return <AdminLogin onLogin={handleLogin} loading={loading} toast={toast} />;
  return <AdminDashboard admin={admin} schools={schools} loading={loading} onCreateSchool={handleCreateSchool} onDeleteSchool={handleDeleteSchool} onLogout={() => { setAdmin(null); setScreen("login"); }} toast={toast} />;
}

function AdminLogin({ onLogin, loading, toast }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 to-slate-800 p-6">
      {toast && <div className={`fixed top-5 right-5 z-50 px-5 py-3.5 rounded-2xl shadow-2xl font-bold text-sm ${toast.type === "error" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}`}>{toast.msg}</div>}
      <div className="bg-white/[0.05] backdrop-blur-xl border border-white/10 rounded-[3rem] p-12 w-full max-w-md shadow-2xl">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-amber-500 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 text-3xl">👑</div>
          <p className="text-amber-400 text-[10px] font-black uppercase tracking-[0.4em] mb-2">管理者専用</p>
          <h1 className="text-3xl font-black text-white tracking-tight">Admin Console</h1>
          <p className="text-slate-500 text-xs mt-2">池田山商店 · システム管理</p>
        </div>
        <div className="space-y-4">
          <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && onLogin(email, pw)} className="w-full bg-white/5 border border-white/10 text-white rounded-2xl p-4 font-bold outline-none focus:border-amber-500 placeholder:text-slate-600" placeholder="管理者メールアドレス" />
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && onLogin(email, pw)} className="w-full bg-white/5 border border-white/10 text-white rounded-2xl p-4 font-bold outline-none focus:border-amber-500 placeholder:text-slate-600" placeholder="パスワード" />
          <button onClick={() => onLogin(email, pw)} disabled={loading} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white p-4 rounded-2xl font-black text-base shadow-xl transition-all active:scale-95">
            {loading ? "認証中..." : "管理者ログイン"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ admin, schools, loading, onCreateSchool, onDeleteSchool, onLogout, toast }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const filtered = schools.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.code.toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async () => {
    await onCreateSchool(name, code, password);
    setName(""); setCode(""); setPassword(""); setShowForm(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {toast && <div className={`fixed top-5 right-5 z-50 px-5 py-3.5 rounded-2xl shadow-2xl font-bold text-sm ${toast.type === "error" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}`}>{toast.msg}</div>}

      {/* ヘッダー */}
      <header className="border-b border-white/10 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center text-xl">👑</div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Admin Console</p>
            <p className="font-black text-white">池田山商店 · システム管理</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm font-bold">{admin?.email}</span>
          <button onClick={onLogout} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-black text-slate-400 hover:text-red-400 transition-all">ログアウト</button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-8 space-y-8">
        {/* サマリー */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "契約校数", value: schools.length + "校", color: "text-amber-400" },
            { label: "今月追加", value: schools.filter(s => new Date(s.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length + "校", color: "text-blue-400" },
            { label: "システム状態", value: "正常稼働", color: "text-emerald-400" },
          ].map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-xs text-slate-500 font-bold mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* 学校追加フォーム */}
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="font-black text-white">🏫 学校アカウント管理</h2>
            <button onClick={() => setShowForm(!showForm)} className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-black text-sm transition-all">
              {showForm ? "✕ キャンセル" : "＋ 新規学校を追加"}
            </button>
          </div>

          {showForm && (
            <div className="p-6 border-b border-white/10 bg-amber-500/5 space-y-4">
              <p className="text-amber-400 font-black text-sm">新しい学校アカウントを作成</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">学校名 *</label>
                  <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-white/5 border border-white/20 text-white rounded-xl p-3 font-bold outline-none focus:border-amber-500" placeholder="例: 池田山高等学校" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ログインコード *</label>
                  <input value={code} onChange={e => setCode(e.target.value)} className="w-full bg-white/5 border border-white/20 text-white rounded-xl p-3 font-bold outline-none focus:border-amber-500 font-mono" placeholder="例: school02" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">初期パスワード *</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-white/5 border border-white/20 text-white rounded-xl p-3 font-bold outline-none focus:border-amber-500" placeholder="8文字以上推奨" />
                </div>
              </div>
              <button onClick={handleSubmit} disabled={loading || !name || !code || !password} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white py-3.5 rounded-xl font-black text-sm transition-all active:scale-95">
                {loading ? "作成中..." : "✅ 学校アカウントを作成"}
              </button>
            </div>
          )}

          {/* 検索 */}
          <div className="px-6 py-4 border-b border-white/10">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="学校名・コードで検索..." className="w-full bg-white/5 border border-white/10 text-white rounded-xl p-3 text-sm font-bold outline-none focus:border-amber-500 placeholder:text-slate-600" />
          </div>

          {/* 学校一覧 */}
          {filtered.length === 0 ? (
            <div className="py-20 text-center text-slate-600 font-black">学校が登録されていません</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-white/10">
                  {["学校名", "ログインコード", "登録日", "操作"].map(h => (
                    <th key={h} className="px-6 py-3.5 text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-white/5 transition-all">
                    <td className="px-6 py-4 font-bold text-white">{s.name}</td>
                    <td className="px-6 py-4 font-mono text-amber-400 text-sm">{s.code}</td>
                    <td className="px-6 py-4 text-slate-400 text-xs font-bold">{new Date(s.created_at).toLocaleDateString("ja-JP")}</td>
                    <td className="px-6 py-4">
                      <button onClick={() => onDeleteSchool(s.id, s.name)} className="px-4 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs font-black hover:bg-red-500/20 transition-all">
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 注意事項 */}
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6">
          <p className="font-black text-amber-400 mb-2">⚠️ 管理者向け注意事項</p>
          <ul className="text-amber-300/70 text-sm space-y-1 font-medium">
            <li>・学校を削除すると、その学校のテスト・採点データがすべて削除されます</li>
            <li>・このページのURLを学校の先生に共有しないでください</li>
            <li>・パスワードは各学校の担当者に直接連絡してください</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
