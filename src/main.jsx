import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import {
  Activity, AlertCircle, AlertTriangle, ArrowDown, ArrowRight, Bell, BookOpen, Bot, Check,
  CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clipboard, Clock3, Database, FileText,
  Globe2, ImagePlus, LifeBuoy, LoaderCircle, MessageSquareText, MoreHorizontal, Pencil, Plus,
  Search, Send, ShieldCheck, Sparkles, Trash2, UsersRound, X, Zap, Settings, Upload
} from 'lucide-react';
import './style.css';

const blankContext = { service_id: '', market_id: '', severity: '', scope: '' };
const severityLabel = { P1: 'Low', P2: 'Medium', P3: 'High', P4: 'Critical' };
const actions = { create: 'Tạo thông tin xử lý', update: 'Cập nhật sự cố', close: 'Đóng sự cố', chat: 'Tin nhắn' };

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không thể hoàn tất yêu cầu.');
  return data;
}
function shortDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(value));
}
function nextUpdate(incident) {
  if (!incident?.last_bulletin_at || incident.status === 'closed' || incident.severity === 'UNKNOWN' || (incident.severity === 'P4' && incident.scope === 'unknown') || (['P1', 'P2'].includes(incident.severity) && incident.scope !== 'internal')) return null;
  const minutes = incident.severity === 'P4' && incident.scope === 'internal' ? 15 : ['P3', 'P4'].includes(incident.severity) ? 30 : 240;
  return { minutes, time: new Date(new Date(incident.last_bulletin_at).getTime() + minutes * 60000) };
}
function Button({ children, icon: Icon, variant = 'primary', className = '', ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{Icon && <Icon size={16} strokeWidth={2} />}{children}</button>;
}
function Empty({ icon: Icon = Search, title, children }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={24} /></div><strong>{title}</strong><p>{children}</p></div>;
}
function Field({ label, children, hint, required }) {
  return <label className="field"><span>{label}{required && <em> *</em>}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Modal({ title, subtitle, onClose, children, wide = false }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={19}/></button></div>{children}
  </section></div>;
}
function App() {
  const [data, setData] = useState({ services: [], markets: [], alerts: [], incidents: [], ai: { enabled: false } });
  const [page, setPage] = useState('incident');
  const [incident, setIncident] = useState(null);
  const [messages, setMessages] = useState([]);
  const [context, setContext] = useState(blankContext);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null);
  const [technical, setTechnical] = useState(false);
  const [business, setBusiness] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMode, setAnalysisMode] = useState('');
  const manualFields = useRef(new Set());
  const latestAnalysis = useRef(null);
  const fileRef = useRef(null);
  const endRef = useRef(null);

  async function refresh() { setData(await api('/api/bootstrap')); }
  useEffect(() => { refresh().catch(error => setToast(error.message)); }, []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);
  const service = data.services.find(item => String(item.id) === String(context.service_id));
  const market = data.markets.find(item => String(item.id) === String(context.market_id));
  async function changeContext(key, value) {
    const previous = context;
    manualFields.current.add(key);
    setContext(current => ({ ...current, [key]: value }));
    if (!incident) return;
    setBusy(true);
    try {
      const result = await api(`/api/incidents/${incident.id}/context`, { method: 'PATCH', body: { field: key, value } });
      setIncident(result.incident);
      await refresh();
      setToast('Đã lưu thay đổi cho sự cố.');
    } catch (error) { setContext(previous); manualFields.current.delete(key); setToast(error.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (incident || busy || (!draft.trim() && !images.length)) return;
    const controller = new AbortController();
    const signature = JSON.stringify([draft, images]);
    const timer = setTimeout(async () => {
      setAnalyzing(true);
      try {
        const result = await api('/api/analyze-incident', { method: 'POST', signal: controller.signal, body: { text: draft, attachments: images } });
        if (controller.signal.aborted) return;
        latestAnalysis.current = { signature, result };
        setAnalysisMode(result.mode);
        if (result.mode === 'local_error') setToast(`${result.error || 'Không thể kết nối AI'}. Chỉ nhận diện được thông tin có sẵn trong văn bản.`);
        setContext(current => {
          const next = { ...current };
          for (const field of ['service_id', 'market_id', 'severity', 'scope']) if (!manualFields.current.has(field)) next[field] = result.fields[field] || '';
          return next;
        });
      } catch (error) { if (error.name !== 'AbortError') setToast(error.message); }
      finally { if (!controller.signal.aborted) setAnalyzing(false); }
    }, 1200);
    return () => { clearTimeout(timer); controller.abort(); setAnalyzing(false); };
  }, [draft, images, incident, busy]);
  const isClosed = incident?.status === 'closed';
  const next = nextUpdate(incident);
  const remainingMinutes = next ? Math.ceil((next.time.getTime() - clock) / 60000) : null;

  function newIncident() {
    if (busy) { setToast('Vui lòng chờ yêu cầu hiện tại hoàn tất.'); return; }
    if ((draft.trim() || images.length) && !window.confirm('Nội dung chưa gửi sẽ bị bỏ. Bắt đầu sự cố mới?')) return;
    manualFields.current = new Set(); latestAnalysis.current = null; setAnalysisMode('');
    setIncident(null); setMessages([]); setContext(blankContext); setDraft(''); setImages([]); setPage('incident');
  }
  async function openIncident(id) {
    if (busy) { setToast('Vui lòng chờ yêu cầu hiện tại hoàn tất.'); return; }
    if ((draft.trim() || images.length) && !window.confirm('Nội dung chưa gửi sẽ bị bỏ. Mở sự cố khác?')) return;
    try {
      const result = await api(`/api/incidents/${id}`);
      setIncident(result.incident); setMessages(result.messages);
      manualFields.current = new Set(JSON.parse(result.incident.manual_fields || '[]'));
      setContext({ service_id: result.incident.service_id || '', market_id: result.incident.market_id || '', severity: result.incident.severity === 'UNKNOWN' ? '' : result.incident.severity, scope: result.incident.scope === 'unknown' ? '' : result.incident.scope });
      setDraft(''); setImages([]); setPage('incident');
    } catch (error) { setToast(error.message); }
  }
  async function addImages(files) {
    const selected = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (!selected.length) return;
    if (images.length + selected.length > 4 || selected.some(file => file.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))) {
      setToast('Tối đa 4 ảnh PNG, JPG, WEBP hoặc GIF, mỗi ảnh không quá 4 MB.'); return;
    }
    try {
      const loaded = await Promise.all(selected.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve({ name: file.name || 'Ảnh từ clipboard', data: reader.result }); reader.onerror = reject; reader.readAsDataURL(file);
      })));
      setImages(current => [...current, ...loaded]);
    } catch { setToast('Không thể đọc ảnh. Vui lòng thử lại.'); }
  }
  async function send(action, confirmation = {}) {
    if (busy) return;
    if (!draft.trim() && !images.length) { setToast('Hãy nhập thông tin hoặc đính kèm ảnh sự cố.'); return; }
    if (action !== 'create' && !incident) { setToast('Hãy tạo thông tin xử lý để bắt đầu phiên sự cố.'); return; }
    setBusy(true);
    try {
      let resolvedContext = context;
      let analysis;
      if (action === 'create') {
        const signature = JSON.stringify([draft, images]);
        analysis = latestAnalysis.current?.signature === signature ? latestAnalysis.current.result : await api('/api/analyze-incident', { method: 'POST', body: { text: draft, attachments: images } });
        resolvedContext = { ...context };
        for (const field of ['service_id', 'market_id', 'severity', 'scope']) if (!manualFields.current.has(field)) resolvedContext[field] = analysis.fields[field] || '';
      }
      const result = await api('/api/chat', { method: 'POST', body: { action, incident_id: incident?.id, text: draft, attachments: images, ...resolvedContext, analysis, manual_fields: [...manualFields.current], ...confirmation } });
      setIncident(result.incident); setMessages(result.messages); setContext({ service_id: result.incident.service_id || '', market_id: result.incident.market_id || '', severity: result.incident.severity === 'UNKNOWN' ? '' : result.incident.severity, scope: result.incident.scope === 'unknown' ? '' : result.incident.scope }); setDraft(''); setImages([]); setModal(null);
      await refresh();
      if (result.mode === 'template_error') setToast(`${result.error || 'Không thể kết nối AI'}. Đã tạo nội dung theo mẫu.`);
    } catch (error) { setToast(error.message); }
    finally { setBusy(false); }
  }
  function requestClose() {
    if (!incident) { setToast('Hãy tạo thông tin xử lý để bắt đầu phiên sự cố.'); return; }
    if (!draft.trim() && !images.length) { setToast('Hãy nhập kết quả xử lý trước khi đóng sự cố.'); return; }
    setConfirmed(false); setTechnical(false); setBusiness(false); setModal({ type: 'close' });
  }
  async function copy(content) {
    try { await navigator.clipboard.writeText(content); setToast('Đã sao chép nội dung.'); }
    catch { setToast('Không thể sao chép tự động. Hãy chọn và sao chép nội dung.'); }
  }
  const nav = [
    { id: 'incident', label: 'Điều phối sự cố', icon: MessageSquareText },
    { id: 'lookup', label: 'Tra cứu alert', icon: Search },
    { id: 'alerts', label: 'Quản lý alert', icon: Bell },
    { id: 'contacts', label: 'Dữ liệu liên hệ', icon: UsersRound },
    { id: 'settings', label: 'Cài đặt chung', icon: Settings },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Activity size={22}/></div><div><strong>NOC<span> / </span>HUB</strong><small>INCIDENT WORKSPACE</small></div></div>
      <div className="sidebar-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav>{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-label={item.label} title={item.label} onClick={() => setPage(item.id)}><item.icon size={18}/><span>{item.label}</span>{page === item.id && <ChevronRight className="nav-arrow" size={15}/>}</button>)}</nav>
      <div className="sidebar-section"><div className="sidebar-label sidebar-label-row"><span>SỰ CỐ GẦN ĐÂY</span><button onClick={newIncident} title="Sự cố mới" aria-label="Sự cố mới"><Plus size={16}/></button></div>
        {data.incidents.length ? data.incidents.slice(0, 5).map(item => <button className={`recent-item ${incident?.id === item.id && page === 'incident' ? 'selected' : ''}`} onClick={() => openIncident(item.id)} key={item.id}><span className={`recent-dot ${item.status === 'closed' ? 'closed' : ''}`}/><span className="recent-copy"><strong>{item.service_name || item.title}</strong><small>{item.status === 'closed' ? 'Đã đóng' : 'Đang xử lý'} · {shortDate(item.updated_at)}</small></span></button>) : <p className="recent-empty">Chưa có phiên sự cố nào</p>}
      </div>
      <div className="sidebar-bottom"><div className="sidebar-help"><div className="help-icon"><LifeBuoy size={18}/></div><div><strong>Luôn sẵn sàng hỗ trợ</strong><span>Đồng hành cùng ca trực NOC</span></div></div><div className="sidebar-user"><div className="avatar">N</div><div><strong>NOC Engineer</strong><small>Không gian làm việc</small></div><MoreHorizontal size={17}/></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14}/> <strong>{nav.find(item => item.id === page)?.label}</strong></div><div className="top-actions"><span className="top-status"><span className={`status-dot ${data.ai.enabled ? '' : 'muted'}`}/>{data.ai.enabled ? 'Đã cấu hình AI' : 'Chế độ mẫu'}</span><span className="top-divider"/><div className="top-avatar">N</div></div></header>
      <main className={`page ${page === 'incident' ? 'incident-page' : ''}`}>
        {page === 'incident' && <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> INCIDENT WORKSPACE</div><h1>Điều phối sự cố</h1><p>Tập trung thông tin, phối hợp xử lý và cập nhật đến các bên.</p></div><Button variant="outline" icon={Plus} onClick={newIncident}>Sự cố mới</Button></div>
          <div className="workspace-grid">
            <section className="chat-panel panel">
              <div className="panel-header chat-header"><div className="assistant-icon"><Sparkles size={19}/></div><div><h2>Trợ lý sự cố</h2><p>{incident ? (incident.status === 'closed' ? 'Phiên sự cố đã đóng' : 'Đang theo dõi phiên sự cố') : 'Sẵn sàng hỗ trợ bạn xử lý sự cố'}</p></div><span className={`session-badge ${isClosed ? 'finished' : ''}`}><span className="status-dot"/>{isClosed ? 'Đã đóng' : incident ? 'Đang xử lý' : 'Sẵn sàng'}</span></div>
              <div className="chat-scroll">
                {!messages.length ? <div className="welcome">
                  <div className="welcome-symbol"><div><Activity size={31}/></div><span><Sparkles size={14}/></span></div>
                  <h2>Bắt đầu xử lý sự cố</h2><p>Chia sẻ thông tin sự cố để tạo bản tin, xác định đầu mối và phối hợp xử lý nhanh hơn.</p>
                  <div className="welcome-steps"><div><span><FileText size={17}/></span><strong>Nhập thông tin</strong><small>Dán nội dung chat hoặc alert</small></div><div><span><ImagePlus size={17}/></span><strong>Thêm hình ảnh</strong><small>Đính kèm ảnh chụp sự cố</small></div><div><span><UsersRound size={17}/></span><strong>Chọn đầu mối</strong><small>Theo dịch vụ và thị trường</small></div></div>
                </div> : <div className="messages">{messages.map(message => <div key={message.id} className={`message ${message.role}`}>
                  <div className={`message-avatar ${message.role === 'assistant' ? 'bot' : ''}`}>{message.role === 'assistant' ? <Sparkles size={16}/> : 'N'}</div>
                  <div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Trợ lý sự cố' : 'Bạn'}</strong><span>{shortDate(message.created_at)}</span>{message.role === 'assistant' && message.mode !== 'ai' && <span className="mode-tag">Mẫu hỗ trợ</span>}</div>
                    {message.role === 'assistant' ? <><div className="markdown"><ReactMarkdown>{message.content}</ReactMarkdown></div><button className="copy-link" onClick={() => copy(message.content)}><Clipboard size={14}/> Sao chép nội dung</button></> : <><p className="user-text">{message.content}</p>{message.attachments?.length > 0 && <div className="message-images">{message.attachments.map((image, i) => <a href={image.data} target="_blank" rel="noreferrer" key={i}><img src={image.data} alt={image.name}/></a>)}</div>}</>}
                  </div></div>)}{busy && <div className="thinking"><LoaderCircle size={16} className="spin"/> Đang chuẩn bị nội dung...</div>}<div ref={endRef}/></div>}
              </div>
              <div className="composer-wrap">
                {!data.ai.enabled ? <div className="ai-notice"><CircleHelp size={14}/> Đang dùng mẫu hỗ trợ. Kết nối AI để phân tích ảnh và nội dung tự động.</div> : <div className="ai-notice connected"><CircleHelp size={14}/> Nội dung phiên, ảnh và danh bạ được gửi tới nhà cung cấp AI để xử lý.</div>}
                {isClosed ? <div className="closed-notice"><CheckCircle2 size={18}/> Sự cố đã đóng. <button onClick={newIncident}>Bắt đầu sự cố mới</button></div> : <>
                  <div className="composer" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addImages(event.dataTransfer.files); }}>
                    {images.length > 0 && <div className="image-previews">{images.map((image, index) => <div key={index}><img src={image.data} alt={image.name}/><button onClick={() => setImages(images.filter((_, i) => i !== index))} aria-label="Xóa ảnh"><X size={12}/></button></div>)}</div>}
                    <textarea value={draft} onChange={event => setDraft(event.target.value)} onPaste={event => { const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean); if (files.length) addImages(files); }} placeholder={incident ? 'Nhập diễn biến mới hoặc dán ảnh vào đây...' : 'Nhập thông tin sự cố, dán alert hoặc thêm hình ảnh...'} aria-label="Thông tin sự cố" rows={2}/>
                    <div className="composer-footer"><div><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { addImages(event.target.files); event.target.value = ''; }}/><button className="attach-button" onClick={() => fileRef.current?.click()}><ImagePlus size={17}/> Thêm ảnh</button><span className="composer-hint">Có thể dán ảnh trực tiếp</span></div><button className="send-button" disabled={busy} onClick={() => send(incident ? 'chat' : 'create')} aria-label="Gửi tin nhắn"><Send size={17}/></button></div>
                  </div>
                  <div className="action-row"><span>THAO TÁC</span><button disabled={busy || !!incident} onClick={() => send('create')}><Sparkles size={15}/> Tạo thông tin xử lý</button><button disabled={busy || !incident} onClick={() => send('update')}><Activity size={15}/> Cập nhật sự cố</button><button disabled={busy || !incident} onClick={requestClose}><CheckCircle2 size={15}/> Đóng sự cố</button></div>
                </>}
              </div>
            </section>
            <aside className="context-column">
              <section className="panel context-panel"><div className="section-title"><div><h3>Thông tin sự cố</h3><p>{analyzing ? 'Đang phân tích sự cố...' : analysisMode === 'ai' && !incident ? 'Gợi ý từ AI · có thể chỉnh sửa' : 'Ngữ cảnh cho phiên xử lý'}</p></div><span className="title-icon"><FileText size={17}/></span></div>
                <div className="context-fields"><Field label="Dịch vụ"><select value={context.service_id} disabled={isClosed || busy} onChange={event => changeContext('service_id', event.target.value)}><option value="">{incident?.service_name && !context.service_id ? `Đã lưu: ${incident.service_name}` : 'Chọn dịch vụ'}</option>{data.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                  <Field label="Thị trường"><select value={context.market_id} disabled={isClosed || busy} onChange={event => changeContext('market_id', event.target.value)}><option value="">{incident?.market_name && !context.market_id ? `Đã lưu: ${incident.market_name}` : 'Chọn thị trường'}</option>{data.markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                  <Field label="Mức độ"><select value={context.severity} disabled={isClosed || busy} onChange={event => changeContext('severity', event.target.value)}><option value="">Chưa xác định</option>{Object.entries(severityLabel).map(([key, label]) => <option key={key} value={key}>{key} — {label}</option>)}</select></Field>
                  <Field label="Phạm vi truyền thông"><select value={context.scope} disabled={isClosed || busy} onChange={event => changeContext('scope', event.target.value)}><option value="">Chưa xác định</option><option value="internal">Internal</option><option value="external">External / Global</option></select></Field>
                </div><div className="context-foot"><CircleHelp size={14}/> {incident ? 'Thay đổi được lưu ngay cho sự cố.' : 'Bạn có thể sửa gợi ý trước khi tạo sự cố.'}</div>
              </section>
              <section className="panel contacts-panel"><div className="section-title"><div><h3>Đầu mối liên hệ</h3><p>Theo dịch vụ & thị trường</p></div><button onClick={() => setPage('contacts')} className="text-link">Quản lý <ArrowRight size={13}/></button></div>
                {service || market ? <div className="contact-list">{service && <><ContactLine label="DEV PIC" value={service.primary_contact}/><ContactLine label="DEV BACKUP" value={service.backup_contact}/>{service.dba && <ContactLine label="DBA" value={service.dba}/>}</>}{market && <><ContactLine label="DEVOPS" value={market.devops}/><ContactLine label="DEVOPS BACKUP" value={market.backup}/><ContactLine label="PMO" value={market.pmo}/></>}</div> : <div className="contact-empty"><div><UsersRound size={19}/></div><p>Chọn dịch vụ và thị trường để xem các đầu mối liên quan.</p></div>}
              </section>
              <section className="sla-card"><div className="sla-icon"><Clock3 size={18}/></div><div><strong>Nhịp cập nhật SLA</strong><p>{next ? `Dự kiến bản tin tiếp theo lúc ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(next.time)}.` : incident?.status === 'closed' ? 'Phiên sự cố đã kết thúc.' : incident ? 'Kiểm tra mức độ và phạm vi để xác định lịch SLA.' : 'Theo dõi thời điểm cập nhật sau khi tạo bản tin.'}</p><small>{next ? `${remainingMinutes <= 0 ? 'Đã đến hạn cập nhật' : `Còn ${remainingMinutes} phút`} · Tính từ lúc tạo bản tin, trước khi có solution.` : 'P3 / P4 cần ưu tiên phản hồi sớm.'}</small></div></section>
            </aside>
          </div>
        </>}
        {page === 'lookup' && <Lookup data={data} setPage={setPage} toast={setToast}/>}
        {page === 'alerts' && <Alerts data={data} refresh={refresh} toast={setToast}/>}
        {page === 'contacts' && <Contacts data={data} refresh={refresh} toast={setToast}/>}
        {page === 'settings' && <SettingsPage data={data} refresh={refresh} toast={setToast}/>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><AlertCircle size={16}/>{toast}<button onClick={() => setToast('')} aria-label="Đóng"><X size={15}/></button></div>}
    {modal?.type === 'close' && <Modal title="Xác nhận đóng sự cố" subtitle="Kiểm tra trạng thái khôi phục trước khi tạo bản tin đóng." onClose={() => setModal(null)}><div className="modal-content"><label className="check-row"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> Tôi đã xác nhận dịch vụ khôi phục.</label>{(['P3', 'P4'].includes(context.severity) || ['P3', 'P4'].includes(incident?.severity)) && <><label className="check-row"><input type="checkbox" checked={technical} onChange={event => setTechnical(event.target.checked)}/> Đã kiểm chứng các chỉ số kỹ thuật và trạng thái hệ thống.</label><label className="check-row"><input type="checkbox" checked={business} onChange={event => setBusiness(event.target.checked)}/> Đã xác nhận luồng nghiệp vụ với các bên liên quan.</label></>}<p className="modal-note">Kết quả trong ô chat sẽ được dùng để tạo bản tin đóng sự cố.</p></div><div className="modal-footer"><Button variant="outline" onClick={() => setModal(null)}>Hủy</Button><Button disabled={!confirmed || ((['P3', 'P4'].includes(context.severity) || ['P3', 'P4'].includes(incident?.severity)) && (!technical || !business)) || busy} onClick={() => send('close', { confirmed, technical_confirmed: technical, business_confirmed: business })}>{busy ? 'Đang tạo...' : 'Xác nhận đóng'}</Button></div></Modal>}
  </div>;
}
function ContactLine({ label, value }) { return <div className="contact-line"><span>{label}</span><p>{value || 'Cần xác nhận PIC'}</p></div>; }

function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> {eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function Lookup({ data, setPage, toast }) {
  const [query, setQuery] = useState('');
  const [marketId, setMarketId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  async function search(event) {
    event.preventDefault(); setLoading(true); setResult(null);
    try { setResult(await api('/api/match-alert', { method: 'POST', body: { query, market_id: marketId } })); }
    catch (error) { toast(error.message); } finally { setLoading(false); }
  }
  return <div className="content-page"><PageTitle eyebrow="ALERT KNOWLEDGE" title="Tra cứu alert" description="Tìm hướng xử lý và đầu mối phù hợp theo từng thị trường." action={<Button variant="outline" icon={BookOpen} onClick={() => setPage('alerts')}>Quản lý alert</Button>}/>
    <div className="lookup-grid"><section className="panel lookup-form"><div className="section-title"><div><h3>Thông tin alert</h3><p>Dán nội dung alert bạn nhận được</p></div><span className="title-icon"><Search size={17}/></span></div><form onSubmit={search}>
      <Field label="Thị trường" required><select value={marketId} onChange={event => setMarketId(event.target.value)} required><option value="">Chọn thị trường</option>{data.markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Nội dung alert" required><textarea className="lookup-textarea" value={query} onChange={event => setQuery(event.target.value)} placeholder={'Dán nội dung alert vào đây...\n\nVí dụ: [FIRING] High CPU usage on payment-service'} required/></Field>
      <Button type="submit" icon={loading ? LoaderCircle : Sparkles} disabled={loading}>{loading ? 'Đang tìm hướng xử lý...' : 'Tìm hướng xử lý'}</Button>
    </form><div className="lookup-note"><ShieldCheck size={17}/><p>Kết quả được đối chiếu với các alert đã lưu cho thị trường được chọn và các quy tắc áp dụng chung.</p></div></section>
    <section className="panel result-panel"><div className="section-title"><div><h3>Hướng xử lý đề xuất</h3><p>{result ? `${result.matches.length} kết quả phù hợp` : 'Kết quả sẽ xuất hiện tại đây'}</p></div>{result && <span className="result-mode">{result.mode === 'ai' ? 'AI đối chiếu' : 'So khớp từ khóa'}</span>}</div>
      {!result && <Empty icon={Search} title="Sẵn sàng tra cứu">Chọn thị trường và dán alert để tìm thông tin xử lý trong kho dữ liệu.</Empty>}
      {result && !result.matches.length && <Empty icon={Search} title="Chưa tìm thấy alert phù hợp">Hãy kiểm tra lại nội dung hoặc thêm hướng xử lý trong phần quản lý alert.</Empty>}
      {result?.mode === 'keyword_error' && <div className="inline-warning">AI chưa khả dụng. Kết quả đang dùng so khớp từ khóa.</div>}
      <div className="results">{result?.matches.map(item => <article className="result-card" key={item.id}><div className="result-head"><div><span className="result-icon"><Zap size={16}/></span><div><h4>{item.title}</h4><p>{item.market_name || 'Tất cả thị trường'} {item.service_name && `· ${item.service_name}`}</p></div></div>{item.confidence && <span className="result-mode">{item.confidence}</span>}</div><p className="match-reason">{item.explanation}</p><div className="result-steps"><strong>Hướng xử lý</strong><p>{item.steps}</p></div><div className="result-contacts"><span><UsersRound size={15}/> {item.team || 'Chưa có đội phụ trách'}</span><span><MessageSquareText size={15}/> {item.contact || 'Chưa có đầu mối'}</span></div></article>)}</div>
    </section></div>
  </div>;
}
function Alerts({ data, refresh, toast }) {
  const [search, setSearch] = useState('');
  const [market, setMarket] = useState('');
  const [editor, setEditor] = useState(null);
  const filtered = data.alerts.filter(item => `${item.title} ${item.pattern} ${item.keywords} ${item.team}`.toLowerCase().includes(search.toLowerCase()) && (!market || String(item.market_id) === market));
  async function remove(item) {
    if (!window.confirm(`Xóa alert “${item.title}”?`)) return;
    try { await api(`/api/alerts/${item.id}`, { method: 'DELETE' }); await refresh(); toast('Đã xóa alert.'); } catch (error) { toast(error.message); }
  }
  return <div className="content-page"><PageTitle eyebrow="KNOWLEDGE BASE" title="Quản lý alert" description="Xây dựng kho alert và hướng xử lý cho từng thị trường." action={<Button icon={Plus} onClick={() => setEditor({})}>Thêm alert</Button>}/>
    <div className="summary-strip"><div><span className="summary-icon blue"><Bell size={19}/></span><div><strong>{data.alerts.length}</strong><small>Alert đã lưu</small></div></div><div><span className="summary-icon purple"><Globe2 size={19}/></span><div><strong>{data.markets.length}</strong><small>Nhóm thị trường</small></div></div><p>Thông tin được sử dụng để gợi ý hướng xử lý khi tra cứu.</p></div>
    <section className="panel library-panel"><div className="library-head"><div><h3>Danh sách alert</h3><p>Cập nhật nội dung, đội phụ trách và hướng xử lý</p></div><div className="filters"><div className="search-input"><Search size={16}/><input placeholder="Tìm alert..." value={search} onChange={event => setSearch(event.target.value)}/></div><select value={market} onChange={event => setMarket(event.target.value)}><option value="">Tất cả thị trường</option>{data.markets.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div></div>
      {filtered.length ? <div className="table-wrap"><table><thead><tr><th>ALERT</th><th>THỊ TRƯỜNG</th><th>ĐỘI PHỤ TRÁCH</th><th>HƯỚNG XỬ LÝ</th><th></th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><strong>{item.title}</strong><small className="truncate">{item.pattern}</small></td><td><span className="table-badge">{item.market_name || 'Tất cả'}</span></td><td>{item.team || '—'}</td><td className="truncate-cell">{item.steps}</td><td><div className="row-actions"><button onClick={() => setEditor(item)} title="Chỉnh sửa"><Pencil size={15}/></button><button onClick={() => remove(item)} title="Xóa"><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div> : <Empty icon={Bell} title={data.alerts.length ? 'Không có kết quả' : 'Chưa có alert nào'}>{data.alerts.length ? 'Thử từ khóa hoặc thị trường khác.' : 'Thêm alert đầu tiên cùng hướng xử lý để bắt đầu tra cứu.'}</Empty>}
    </section>{editor && <RecordEditor kind="alerts" record={editor} data={data} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); toast('Đã lưu alert.'); }} toast={toast}/>}
  </div>;
}
function Contacts({ data, refresh, toast }) {
  const [tab, setTab] = useState('services');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null);
  const importRef = useRef(null);
  const [importing, setImporting] = useState(false);
  async function importFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Tệp Excel không được lớn hơn 5 MB.'); return; }
    setImporting(true);
    try {
      const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      const result = await api('/api/import-workbook', { method: 'POST', body: { file: encoded } });
      await refresh();
      toast(`Đã nhập ${result.updatedServices} dịch vụ, thêm ${result.newServices} dịch vụ và cập nhật ${result.updatedMarkets} thị trường.`);
    } catch (error) { toast(error.message || 'Không thể đọc tệp.'); } finally { setImporting(false); }
  }
  const records = data[tab].filter(item => Object.values(item).join(' ').toLowerCase().includes(search.toLowerCase()));
  async function remove(item) {
    if (!window.confirm(`Xóa “${item.name}”?`)) return;
    try { await api(`/api/${tab}/${item.id}`, { method: 'DELETE' }); await refresh(); toast('Đã xóa dữ liệu.'); } catch (error) { toast(error.message); }
  }
  return <div className="content-page"><PageTitle eyebrow="CONTACT DIRECTORY" title="Dữ liệu liên hệ" description="Quản lý đầu mối dịch vụ và vận hành theo thị trường." action={<div className="heading-actions"><input ref={importRef} type="file" accept=".xlsx" hidden onChange={event => { importFile(event.target.files[0]); event.target.value = ''; }}/><Button variant="outline" icon={Upload} disabled={importing} onClick={() => importRef.current?.click()}>{importing ? 'Đang nhập...' : 'Nhập Excel'}</Button><Button icon={Plus} onClick={() => setEditor({})}>{tab === 'services' ? 'Thêm dịch vụ' : 'Thêm thị trường'}</Button></div>}/>
    <div className="summary-strip"><div><span className="summary-icon blue"><Database size={19}/></span><div><strong>{data.services.length}</strong><small>Dịch vụ</small></div></div><div><span className="summary-icon purple"><Globe2 size={19}/></span><div><strong>{data.markets.length}</strong><small>Nhóm thị trường</small></div></div><p>Bổ sung và cập nhật đầu mối cho từng dịch vụ và thị trường.</p></div>
    <section className="panel library-panel"><div className="library-head"><div><h3>Danh bạ vận hành</h3><p>Thông tin PIC và đầu mối dự phòng</p></div><div className="search-input"><Search size={16}/><input placeholder="Tìm tên, dịch vụ, liên hệ..." value={search} onChange={event => setSearch(event.target.value)}/></div></div>
      <div className="tabs"><button className={tab === 'services' ? 'active' : ''} onClick={() => { setTab('services'); setSearch(''); }}>Theo dịch vụ <span>{data.services.length}</span></button><button className={tab === 'markets' ? 'active' : ''} onClick={() => { setTab('markets'); setSearch(''); }}>Theo thị trường <span>{data.markets.length}</span></button></div>
      {records.length ? <div className="table-wrap"><table><thead>{tab === 'services' ? <tr><th>DỊCH VỤ</th><th>TIER</th><th>DEV PIC</th><th>DEV BACKUP</th><th></th></tr> : <tr><th>THỊ TRƯỜNG</th><th>PMO</th><th>DEVOPS</th><th>DEVOPS BACKUP</th><th></th></tr>}</thead><tbody>{records.map(item => <tr key={item.id}><td><strong>{item.name}</strong>{tab === 'markets' && <small>{item.aliases}</small>}</td>{tab === 'services' ? <><td><span className="table-badge">Tier {item.tier}</span></td><td className="contact-cell">{item.primary_contact || '—'}</td><td className="contact-cell">{item.backup_contact || '—'}</td></> : <><td className="contact-cell">{item.pmo || '—'}</td><td className="contact-cell">{item.devops || '—'}</td><td className="contact-cell">{item.backup || '—'}</td></>}<td><div className="row-actions"><button onClick={() => setEditor(item)} title="Chỉnh sửa"><Pencil size={15}/></button><button onClick={() => remove(item)} title="Xóa"><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div> : <Empty icon={UsersRound} title="Không có dữ liệu phù hợp">Thử từ khóa khác hoặc thêm dữ liệu mới.</Empty>}
    </section>{editor && <RecordEditor key={tab} kind={tab} record={editor} data={data} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await refresh(); toast('Đã lưu dữ liệu liên hệ.'); }} toast={toast}/>}
  </div>;
}
function SettingsPage({ data, refresh, toast }) {
  const [actionsText, setActionsText] = useState((data.settings?.actions || []).join('\n'));
  const [questionsText, setQuestionsText] = useState((data.settings?.questions || []).join('\n'));
  const [key, setKey] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [provider, setProvider] = useState(data.ai.provider || 'gemini');
  const [model, setModel] = useState(data.ai.model || (data.ai.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash'));
  const [saving, setSaving] = useState(false);
  async function save(event) {
    event.preventDefault(); setSaving(true);
    try {
      await api('/api/settings', { method: 'PUT', body: { actions: actionsText.split('\n'), questions: questionsText.split('\n') } });
      await refresh(); toast('Đã lưu cài đặt điều phối.');
    } catch (error) { toast(error.message); } finally { setSaving(false); }
  }
  async function connect(event) {
    event.preventDefault(); setSaving(true);
    try { await api('/api/ai-key', { method: 'PUT', body: { key, provider, model } }); setKey(''); setTestResult(null); await refresh(); toast('Đã cấu hình khóa cho phiên chạy hiện tại.'); }
    catch (error) { toast(error.message); } finally { setSaving(false); }
  }
  async function testConnection() {
    setSaving(true); setTestResult(null);
    try { setTestResult(await api('/api/ai-test', { method: 'POST' })); }
    catch (error) { setTestResult({ ok: false, error: error.message }); }
    finally { setSaving(false); }
  }
  return <div className="content-page"><PageTitle eyebrow="SETTINGS" title="Cài đặt chung" description="Điều chỉnh nội dung điều phối cho các sự cố mới."/>
    <section className="panel settings-panel"><div className="section-title"><div><h3>Nội dung điều phối</h3><p>Mỗi dòng tương ứng với một nội dung. AI sẽ điều chỉnh theo ngữ cảnh sự cố.</p></div></div>
      <form onSubmit={save} className="settings-form"><Field label="Ba việc tiếp theo" hint="Nhập đúng 3 dòng."><textarea rows={5} value={actionsText} onChange={event => setActionsText(event.target.value)}/></Field><Field label="Câu hỏi điều phối" hint="Mỗi câu hỏi trên một dòng."><textarea rows={5} value={questionsText} onChange={event => setQuestionsText(event.target.value)}/></Field><Button type="submit" disabled={saving}>Lưu cài đặt</Button></form>
    </section>
    <section className="panel settings-panel"><div className="section-title"><div><h3>Cấu hình AI</h3><p>Chọn nhà cung cấp để phân tích hình ảnh và biên tập nội dung. Khóa chỉ tồn tại trong phiên chạy ứng dụng.</p></div><span className="result-mode">{data.ai.enabled ? 'Đã cấu hình' : 'Chưa cấu hình'}</span></div><form onSubmit={connect} className="settings-form"><Field label="Nhà cung cấp"><select value={provider} onChange={event => { setProvider(event.target.value); setModel(event.target.value === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'); }}><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option></select></Field><Field label="Mô hình"><input value={model} onChange={event => setModel(event.target.value)} /></Field><Field label="API key"><input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="Nhập khóa cho phiên hiện tại"/></Field><div className="heading-actions"><Button type="submit" disabled={!key.trim() || saving}>Lưu khóa AI</Button><Button type="button" variant="outline" disabled={!data.ai.enabled || saving} onClick={testConnection}>{saving ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}</Button></div>{testResult && <div className={testResult.ok ? 'connection-ok' : 'inline-warning'} role="status">{testResult.ok ? 'Kết nối AI thành công.' : testResult.error}</div>}</form></section>
  </div>;
}

function RecordEditor({ kind, record, data, onClose, onSaved, toast }) {
  const [form, setForm] = useState({ tier: 2, ...record });
  const [saving, setSaving] = useState(false);
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const input = (key, placeholder = '', multiline = false) => multiline
    ? <textarea value={form[key] || ''} onChange={event => set(key, event.target.value)} placeholder={placeholder} rows={3}/>
    : <input value={form[key] || ''} onChange={event => set(key, event.target.value)} placeholder={placeholder}/>;
  async function submit(event) {
    event.preventDefault(); setSaving(true);
    try { await api(`/api/${kind}${record.id ? `/${record.id}` : ''}`, { method: record.id ? 'PUT' : 'POST', body: form }); await onSaved(); }
    catch (error) { toast(error.message); } finally { setSaving(false); }
  }
  const title = kind === 'alerts' ? 'alert' : kind === 'services' ? 'dịch vụ' : 'thị trường';
  return <Modal title={`${record.id ? 'Chỉnh sửa' : 'Thêm'} ${title}`} subtitle="Thông tin sẽ được dùng trong quá trình điều phối và tra cứu." onClose={onClose} wide><form onSubmit={submit}>
    <div className="modal-content form-grid">
      {kind === 'services' && <><Field label="Tên dịch vụ" required>{input('name', 'Ví dụ: Payment Service')}</Field><Field label="Tier" required><select value={form.tier} onChange={event => set('tier', event.target.value)}><option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option></select></Field><Field label="Dev PIC">{input('primary_contact', 'Tên, số điện thoại hoặc email', true)}</Field><Field label="Dev backup">{input('backup_contact', 'Tên, số điện thoại hoặc email', true)}</Field><Field label="DBA">{input('dba', 'Tên, số điện thoại hoặc email', true)}</Field><Field label="Tên khác / tên tiếng Việt" hint="Mỗi tên trên một dòng.">{input('aliases', 'Tên dùng để nhận diện dịch vụ', true)}</Field></>}
      {kind === 'markets' && <><Field label="Tên thị trường" required>{input('name', 'Ví dụ: Việt Nam')}</Field><Field label="Tên khác / mã thị trường" hint="Phân cách bằng dấu phẩy">{input('aliases', 'VN, Vietnam')}</Field><Field label="PMO">{input('pmo', 'Tên và liên hệ', true)}</Field><Field label="DevOps">{input('devops', 'Tên và liên hệ', true)}</Field><Field label="DevOps backup">{input('backup', 'Tên và liên hệ', true)}</Field><Field label="TechOps">{input('techops', 'Tên và liên hệ', true)}</Field><Field label="NOC">{input('noc', 'Tên và liên hệ', true)}</Field><Field label="Escalation">{input('escalation', 'Tên và liên hệ', true)}</Field></>}
      {kind === 'alerts' && <><Field label="Tên alert" required>{input('title', 'Ví dụ: CPU usage high')}</Field><Field label="Thị trường"><select value={form.market_id || ''} onChange={event => set('market_id', event.target.value)}><option value="">Tất cả thị trường</option>{data.markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Dịch vụ"><select value={form.service_id || ''} onChange={event => set('service_id', event.target.value)}><option value="">Không chỉ định</option>{data.services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Từ khóa bổ sung" hint="Phân cách bằng dấu phẩy">{input('keywords', 'cpu, usage, high')}</Field><div className="full-field"><Field label="Nội dung alert mẫu" required>{input('pattern', 'Dán nội dung alert để đối chiếu', true)}</Field></div><Field label="Đội phụ trách">{input('team', 'Ví dụ: DevOps / SRE')}</Field><Field label="Người hoặc kênh cần báo">{input('contact', 'Tên, số điện thoại hoặc kênh liên hệ')}</Field><div className="full-field"><Field label="Hướng xử lý" required>{input('steps', 'Các bước kiểm tra, xử lý và escalation', true)}</Field></div></>}
    </div><div className="modal-footer"><Button variant="outline" type="button" onClick={onClose}>Hủy</Button><Button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thông tin'}</Button></div>
  </form></Modal>;
}

createRoot(document.getElementById('root')).render(<App/>);
