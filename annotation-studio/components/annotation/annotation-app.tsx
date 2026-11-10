'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck,
  CheckCircle2, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck,
  FileCheck2, FileText, FlaskConical, Globe2, LayoutGrid, Loader2,
  KeyRound, LockKeyhole, MessageSquare, PanelLeftClose, Scale, ShieldCheck,
  SlidersHorizontal, Sparkles, X,
} from 'lucide-react';
import { CRITERIA, QUESTIONS } from '@/lib/guidelines';
import { SAMPLE_DOCUMENTS } from '@/lib/sample-documents';
import SignOutButton from '@/components/auth/sign-out-button';
import Onboarding, { OnboardingSteps, type Qualification, type TestQuestion } from './onboarding';

type Project = { id: string; name: string; domain: string; description: string; total: number; submitted: number; qualified: boolean; qualificationReady: boolean };
type Session = { user: { id: string; name: string; email: string } | null; isAdmin: boolean; projects: Project[]; configured: boolean; authMode: 'local' | 'chatgpt'; mustChangePassword: boolean };
type Rating = { criterionId: string; score: number | null | undefined; comment: string };
type Receipt = { id: string; savedAt: string; requestId: string; ratings?: Rating[]; comment?: string };
type AnnotationDoc = { id: string; title: string; source: string; question: string; answer: string; submission?: Receipt };
type DocList = { id: string; title: string; submitted: boolean };
type ProjectData = { project: Project; documents: DocList[]; qualification: Qualification; questions: TestQuestion[] };
type Draft = { ratings: Rating[]; comment: string; requestId: string; pending?: boolean };
type View = 'workspace' | 'overview' | 'guidelines' | 'qualification' | 'submissions';

const DEMO_PROJECTS: Project[] = [
  { id: 'eurlex', name: 'EUR-Lex', domain: 'legal', description: 'European Union legislation', total: 3, submitted: 0, qualified: false, qualificationReady: true },
  { id: 'un', name: 'United Nations', domain: 'legal', description: 'International agreements & resolutions', total: 3, submitted: 0, qualified: false, qualificationReady: true },
  { id: 'chemistry', name: 'Chemistry', domain: 'chemistry', description: 'Scientific literature & research', total: 3, submitted: 0, qualified: false, qualificationReady: true },
];
const DEMO_DOCS: Record<string, AnnotationDoc[]> = SAMPLE_DOCUMENTS;
const DEMO_PROGRESS_KEY = 'annotation-demo-onboarding:v2';
const newDemoQualification = (): Qualification => ({ passed: false, ready: true, version: 'demo', guidelineRead: false, guidelineReadAt: null, passedAt: null });
const SCORE_NAMES = ['Unacceptable', 'Major issues', 'Needs improvement', 'Fully successful', 'Exceptional'];

async function api<T>(path: string, body?: unknown, expectedActor?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(expectedActor ? { 'X-Annotation-Actor': expectedActor } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store' });
    const value = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const detail = typeof value.error === 'object' && value.error !== null ? (value.error as { message?: string }).message : value.error;
      const failure = new Error(typeof detail === 'string' ? detail : typeof value.message === 'string' ? value.message : 'The request could not be completed. Please try again.');
      Object.assign(failure, { status: response.status, code: value.code });
      if (response.status === 401 || value.code === 'SESSION_ACCOUNT_MISMATCH') window.dispatchEvent(new Event('annotation:session-expired'));
      if (value.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event('annotation:password-required'));
      throw failure;
    }
    return value as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The server did not confirm this request. Your work is still here. Retry to safely check or complete the submission.');
    throw error;
  } finally { clearTimeout(timeout); }
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const blankDraft = (): Draft => ({ ratings: [], comment: '', requestId: crypto.randomUUID() });
function ProjectIcon({ id, size = 19 }: { id: string; size?: number }) {
  return id === 'chemistry' ? <FlaskConical size={size} /> : id === 'un' ? <Globe2 size={size} /> : <Scale size={size} />;
}

export default function AnnotationApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<View>('overview');
  const [project, setProject] = useState<Project | null>(null);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [doc, setDoc] = useState<AnnotationDoc | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [draftWarning, setDraftWarning] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showScale, setShowScale] = useState(false);
  const [helpCriterion, setHelpCriterion] = useState<string | null>(null);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ passed: boolean; correct: number; total: number } | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [guidelineChecked, setGuidelineChecked] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [demoProgress, setDemoProgress] = useState<Record<string, Qualification>>({});
  const [demoReceipts, setDemoReceipts] = useState<Record<string, Receipt>>({});
  const loadSequence = useRef(0);
  const isChemistry = project?.domain === 'chemistry';
  const projects = demo ? DEMO_PROJECTS.map(p => ({ ...p, qualified: !!demoProgress[p.id]?.passed, submitted: Object.keys(demoReceipts).filter(key => key.startsWith(`${p.id}:`)).length })) : session?.projects || [];
  const user = demo ? { id: 'demo', name: 'Demo annotator', email: 'Sample workspace' } : session?.user;
  const cacheKey = project && doc && user ? `annotation-draft:v1:${user.id}:${project.id}:${doc.id}` : null;
  const completedRatings = draft?.ratings.filter(r => r.score !== undefined).length || 0;
  const activeIndex = projectData?.documents.findIndex(item => item.id === doc?.id) ?? -1;
  const currentQuestions = projectData?.questions || [];
  const signInPath = session?.authMode === 'chatgpt' ? '/signin-with-chatgpt?return_to=/' : '/login';

  function accountApi<T>(path: string, body?: unknown) { return api<T>(path, body, demo ? undefined : user?.id); }

  useEffect(() => {
    const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';
    setDemo(isDemo);
    if (isDemo) {
      setSession({ user: null, isAdmin: false, projects: [], configured: true, authMode: 'local', mustChangePassword: false });
      const p = DEMO_PROJECTS[0];
      setProject(p);
      let progress: Record<string, Qualification> = {};
      try {
        const stored = JSON.parse(sessionStorage.getItem(DEMO_PROGRESS_KEY) || '{}');
        for (const item of DEMO_PROJECTS) {
          const previous = stored[item.id];
          if (previous && typeof previous.passed === 'boolean' && typeof previous.guidelineRead === 'boolean') progress[item.id] = { ...newDemoQualification(), ...previous, guidelineRead: previous.guidelineRead || previous.passed };
        }
      } catch { /* Demo progress is optional and never used by live routes. */ }
      setDemoProgress(progress);
      const qualification = progress[p.id] || newDemoQualification();
      setProjectData({ project: p, documents: qualification.passed ? DEMO_DOCS[p.id].map(d => ({ id: d.id, title: d.title, submitted: false })) : [], qualification, questions: qualification.guidelineRead && !qualification.passed ? QUESTIONS : [] });
      if (qualification.passed) { setDoc(DEMO_DOCS[p.id][0]); setDraft(blankDraft()); setView('workspace'); }
      else setView(qualification.guidelineRead ? 'qualification' : 'guidelines');
    } else {
      api<Session>('/api/session').then(current => {
        if (current.mustChangePassword) { window.location.replace('/account/password'); return; }
        setSession(current);
      }).catch(e => { setError(errorMessage(e)); setSession({ user: null, isAdmin: false, projects: [], configured: false, authMode: 'local', mustChangePassword: false }); });
    }
  }, []);

  useEffect(() => {
    const expired = () => setSessionExpired(true);
    const passwordRequired = () => window.location.assign('/account/password');
    window.addEventListener('annotation:session-expired', expired);
    window.addEventListener('annotation:password-required', passwordRequired);
    return () => { window.removeEventListener('annotation:session-expired', expired); window.removeEventListener('annotation:password-required', passwordRequired); };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    if (demo || !cacheKey || !draft || !dirty || receipt) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(draft)); setDraftWarning(''); }
    catch { setDraftWarning('This browser could not keep a recovery draft. Keep this page open until you submit.'); }
  }, [cacheKey, draft, dirty, demo, receipt]);

  async function checkSessionAgain() {
    if (checkingSession) return;
    setCheckingSession(true);
    try {
      const current = await api<Session>('/api/session');
      if (!current.user) throw new Error('Please sign in, then check your session again.');
      if (current.user.id !== user?.id) throw new Error(`A different account is signed in. Sign in as ${user?.email || 'the original annotator'} to continue this review. Your draft remains unchanged.`);
      if (current.mustChangePassword) { window.location.assign('/account/password'); return; }
      setSession(current); setSessionExpired(false); setError('');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setCheckingSession(false); }
  }

  function clearSignedOutView() {
    setDirty(false); setDoc(null); setDraft(null); setReceipt(null); setProject(null); setProjectData(null);
    setSession(previous => previous ? { ...previous, user: null, isAdmin: false, projects: [] } : previous);
  }

  function canLeave() {
    if (saving || testBusy || acknowledging || busy) return false;
    return !dirty || window.confirm('This document has no confirmed submission. Leave it? Any available recovery draft will remain in this browser.');
  }

  async function openDocument(next: DocList, p = project) {
    if (!p || !projectData?.qualification.passed || !canLeave()) return;
    const sequence = ++loadSequence.current;
    setBusy(true); setError('');
    try {
      const loaded = demo ? { ...DEMO_DOCS[p.id].find(d => d.id === next.id)!, submission: demoReceipts[`${p.id}:${next.id}`] } : await accountApi<AnnotationDoc>(`/api/projects/${p.id}/documents/${encodeURIComponent(next.id)}`);
      if (sequence !== loadSequence.current) return;
      let loadedDraft = blankDraft();
      if (loaded.submission) loadedDraft = { ratings: loaded.submission.ratings || [], comment: loaded.submission.comment || '', requestId: loaded.submission.requestId };
      let recovered = false;
      if (!demo && !loaded.submission && user) {
        try {
          const stored = localStorage.getItem(`annotation-draft:v1:${user.id}:${p.id}:${loaded.id}`);
          if (stored) { const parsed = JSON.parse(stored); if (Array.isArray(parsed.ratings) && typeof parsed.comment === 'string' && typeof parsed.requestId === 'string') { loadedDraft = parsed; recovered = true; } }
        } catch { /* A damaged recovery draft never changes server data. */ }
      }
      setDoc(loaded); setDraft(loadedDraft); setReceipt(loaded.submission || null); setDirty(recovered); setExpanded([]); setView('workspace');
    } catch (e) { setError(errorMessage(e)); }
    finally { if (sequence === loadSequence.current) setBusy(false); }
  }

  async function openProject(p: Project) {
    if (!canLeave()) return;
    const sequence = ++loadSequence.current;
    setBusy(true); setError(''); setProject(p); setDoc(null); setDraft(null); setReceipt(null); setDirty(false); setAnswers({}); setTestResult(null); setGuidelineChecked(false); setShowMobileNav(false);
    try {
      const qualification = demoProgress[p.id] || newDemoQualification();
      const data = demo ? { project: p, documents: qualification.passed ? DEMO_DOCS[p.id].map(d => ({ id: d.id, title: d.title, submitted: !!demoReceipts[`${p.id}:${d.id}`] })) : [], qualification, questions: qualification.guidelineRead && !qualification.passed ? QUESTIONS : [] } : await accountApi<ProjectData>(`/api/projects/${p.id}`);
      if (sequence !== loadSequence.current) return;
      setProjectData(data);
      if (data.qualification.passed) {
        setView('workspace');
        const next = data.documents.find(d => !d.submitted) || data.documents[0];
        if (next) {
          const loaded = demo ? { ...DEMO_DOCS[p.id].find(d => d.id === next.id)!, submission: demoReceipts[`${p.id}:${next.id}`] } : await accountApi<AnnotationDoc>(`/api/projects/${p.id}/documents/${encodeURIComponent(next.id)}`);
          if (sequence !== loadSequence.current) return;
          let recoveredDraft = blankDraft(); let recovered = false;
          if (loaded.submission) recoveredDraft = { ratings: loaded.submission.ratings || [], comment: loaded.submission.comment || '', requestId: loaded.submission.requestId };
          else if (!demo && user) {
            try { const item = localStorage.getItem(`annotation-draft:v1:${user.id}:${p.id}:${next.id}`); if (item) { const parsed = JSON.parse(item); if (Array.isArray(parsed.ratings) && typeof parsed.comment === 'string' && typeof parsed.requestId === 'string') { recoveredDraft = parsed; recovered = true; } } } catch { /* Recovery is optional. */ }
          }
          setDoc(loaded); setDraft(recoveredDraft); setReceipt(loaded.submission || null); setDirty(recovered);
        }
      } else setView(data.qualification.guidelineRead ? 'qualification' : 'guidelines');
    } catch (e) { setProjectData(null); setError(errorMessage(e)); }
    finally { if (sequence === loadSequence.current) setBusy(false); }
  }

  function navigate(next: View) {
    if (!canLeave()) return;
    if ((next === 'workspace' || next === 'submissions') && projectData && !projectData.qualification.passed) next = projectData.qualification.guidelineRead ? 'qualification' : 'guidelines';
    if (next === 'workspace' && project && projectData?.qualification.passed && !doc) { void openProject(project); return; }
    setView(next); setShowMobileNav(false);
  }

  function saveDemoProgress(projectId: string, qualification: Qualification) {
    setDemoProgress(previous => {
      const next = { ...previous, [projectId]: qualification };
      try { sessionStorage.setItem(DEMO_PROGRESS_KEY, JSON.stringify(next)); } catch { /* Demo has no persistent server records. */ }
      return next;
    });
  }

  async function acknowledgeGuideline() {
    if (!project || !projectData || acknowledging) return;
    if (!projectData.qualification.guidelineRead && !guidelineChecked) return;
    setAcknowledging(true); setError('');
    try {
      if (demo) {
        const qualification = { ...projectData.qualification, guidelineRead: true, guidelineReadAt: projectData.qualification.guidelineReadAt || new Date().toISOString() };
        saveDemoProgress(project.id, qualification);
        setProjectData({ ...projectData, qualification, questions: QUESTIONS });
      } else {
        if (!projectData.qualification.guidelineRead) await accountApi(`/api/projects/${project.id}/guideline/acknowledge`, { acknowledged: true });
        const data = await accountApi<ProjectData>(`/api/projects/${project.id}`);
        if (!data.qualification.guidelineRead) throw new Error('The server has not confirmed your guideline acknowledgement. Please retry.');
        setProjectData(data);
      }
      setView('qualification');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setError(errorMessage(e)); }
    finally { setAcknowledging(false); }
  }
  function updateRating(id: string, change: Partial<Rating>) {
    if (!draft || receipt || saving || draft.pending) return;
    const existing = draft.ratings.find(r => r.criterionId === id);
    const updated = { criterionId: id, score: undefined, comment: '', ...existing, ...change };
    setDraft({ ...draft, ratings: [...draft.ratings.filter(r => r.criterionId !== id), updated] }); setDirty(true); setError('');
  }
  function requiredComment(score: number | null | undefined) { return score !== undefined && (score === null || score <= 3 || score === 5 || isChemistry); }
  const invalidRatings = CRITERIA.filter(c => {
    const rating = draft?.ratings.find(r => r.criterionId === c.id);
    return !rating || rating.score === undefined || (requiredComment(rating.score) && !rating.comment.trim());
  });

  async function submit() {
    if (!draft || !doc || !project || saving || receipt || sessionExpired) return;
    if (invalidRatings.length) { setError(`Complete all eight criteria and required explanations before submitting. Still needed: ${invalidRatings.map(c => c.name).join(', ')}.`);
      document.getElementById(`criterion-${invalidRatings[0].id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return; }
    const pendingDraft = { ...draft, pending: true };
    setDraft(pendingDraft); setDirty(true); setSaving(true); setError('');
    if (!demo && cacheKey) {
      try { localStorage.setItem(cacheKey, JSON.stringify(pendingDraft)); }
      catch { setDraftWarning('A recovery copy could not be kept in this browser. Keep this page open until the server confirms the save.'); }
    }
    try {
      const saved = demo ? { id: `DEMO-${doc.id}`, savedAt: new Date().toISOString(), requestId: draft.requestId } : await accountApi<Receipt>(`/api/projects/${project.id}/documents/${encodeURIComponent(doc.id)}/submit`, { requestId: draft.requestId, ratings: draft.ratings, comment: draft.comment });
      if (!saved.id || !saved.savedAt || saved.requestId !== draft.requestId) throw new Error('A complete save receipt was not received. Your work is still here. Please retry.');
      const complete = { ...saved, ratings: draft.ratings, comment: draft.comment };
      setReceipt(complete); setDraft({ ...draft, pending: false }); setDirty(false);
      if (demo) setDemoReceipts(prev => ({ ...prev, [`${project.id}:${doc.id}`]: complete }));
      else {
        if (cacheKey) { try { localStorage.removeItem(cacheKey); } catch { /* Submitted record remains authoritative. */ } }
        setSession(prev => prev ? { ...prev, projects: prev.projects.map(p => p.id === project.id ? { ...p, submitted: p.submitted + 1 } : p) } : prev);
      }
      setProjectData(prev => prev ? { ...prev, documents: prev.documents.map(d => d.id === doc.id ? { ...d, submitted: true } : d) } : prev);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 422) setDraft(prev => prev ? { ...prev, pending: false } : prev);
      setError(errorMessage(e));
    }
    finally { setSaving(false); }
  }

  async function submitTest() {
    if (!project || !projectData?.qualification.guidelineRead || projectData.qualification.passed || testBusy) return;
    setTestBusy(true); setError('');
    try {
      const result = await accountApi<{ passed: boolean; correct: number; total: number }>(demo ? '/api/demo/qualify' : `/api/projects/${project.id}/qualify`, { answers });
      setTestResult(result);
      if (result.passed) {
        const qualification = { ...projectData.qualification, passed: true, passedAt: new Date().toISOString() };
        if (demo) saveDemoProgress(project.id, qualification);
        setProjectData(prev => prev ? { ...prev, qualification, questions: [] } : prev);
        setSession(prev => prev ? { ...prev, projects: prev.projects.map(p => p.id === project.id ? { ...p, qualified: true } : p) } : prev);
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { setTestBusy(false); }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showMobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href={demo ? '/?demo=1' : '/'} onClick={e => { if (!canLeave()) e.preventDefault(); }} aria-label="Annotation Studio home"><span className="brand-symbol"><span /><span /><span /></span><span>annotation<span className="brand-studio">STUDIO</span></span></a>
        <div className="workspace-label"><span className="workspace-avatar">R</span><div>Research workspace<small>{demo ? 'Interactive preview' : 'Annotation platform'}</small></div><ChevronDown size={14} /></div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Workspace navigation">
          <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => navigate('overview')}><LayoutGrid size={18} />My projects</button>
          <button className={`nav-item ${view === 'workspace' ? 'active' : ''}`} disabled={!project || !projectData?.qualification.passed} onClick={() => navigate('workspace')}><ClipboardCheck size={18} />Annotation workspace{dirty && <span className="nav-dot" />}</button>
          <button className={`nav-item ${view === 'submissions' ? 'active' : ''}`} disabled={!project || !projectData?.qualification.passed} onClick={() => navigate('submissions')}><FileCheck2 size={18} />My submissions</button>
        </nav>
        <div className="nav-caption nav-caption-projects">YOUR PROJECTS<span>{projects.length.toString().padStart(2, '0')}</span></div>
        <nav className="project-nav" aria-label="Assigned projects">
          {projects.map(p => <button key={p.id} className={`project-link ${project?.id === p.id ? 'selected' : ''}`} onClick={() => openProject(p)} disabled={saving}><span className={`project-dot ${p.id}`} />{p.name}{project?.id === p.id && <ChevronRight size={14} />}</button>)}
          {!projects.length && <p className="sidebar-empty">Your assigned projects will appear here.</p>}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={21} /><strong>Your independent review</strong><p>Your ratings are private. Other annotators cannot see your work.</p></div>
          <button className={`nav-item ${(view === 'guidelines' || view === 'qualification') ? 'active' : ''}`} disabled={!project} onClick={() => navigate('guidelines')}><BookOpen size={18} />Guidelines & qualification</button>
          {user && !demo && session?.authMode !== 'chatgpt' && <a className="nav-item" href="/account/password" onClick={event => { if (!canLeave()) event.preventDefault(); }}><KeyRound size={18} />Change password</a>}
          {session?.isAdmin && !demo && <a className="nav-item" href="/admin"><SlidersHorizontal size={18} />Administration</a>}
          <div className="profile"><span className="profile-avatar">{user?.name?.slice(0, 2).toUpperCase() || 'AS'}</span><div><strong>{user?.name || 'Welcome'}</strong><small>{demo ? 'Demo annotator' : user ? session?.isAdmin ? 'Administrator' : 'Annotator' : 'Sign in to annotate'}</small></div>{user && !demo && <SignOutButton authMode={session?.authMode} onBeforeSignOut={canLeave} onSignedOut={clearSignedOutView} />}</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><div className="breadcrumbs"><button className="mobile-menu icon-button" onClick={() => setShowMobileNav(!showMobileNav)} aria-label="Toggle navigation"><PanelLeftClose size={20} /></button><span>Workspace</span><ChevronRight size={13} /><span>{project && view !== 'overview' ? project.name : 'My projects'}</span>{view === 'workspace' && doc && <><ChevronRight size={13} /><strong>Annotation</strong></>}</div><div className="topbar-right"><span className="private-label"><LockKeyhole size={13} />Private workspace</span>{demo ? <a className="text-link" href="/">Exit preview <ArrowRight size={14} /></a> : !user ? <a className="button button-small" href={signInPath} target="_top">Sign in <ArrowRight size={14} /></a> : <span className="user-chip">{user.name?.split(' ')[0]}</span>}</div></header>
        {demo && <div className="demo-banner"><Sparkles size={14} /><strong>Demo workspace</strong><span>Sample documents. Preview submissions stay in this session and are not saved to the server.</span>{projectData?.qualification.passed && <a className="demo-csv-link" href={`/samples/${project?.id || 'eurlex'}.csv`} download><ArrowDownToLine size={12} />Sample CSV</a>}</div>}
        <main className={`main-content ${view === 'workspace' ? 'workspace-content' : ''}`}>
          {error && <div className="notice notice-error" role="alert"><CircleHelp size={18} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
          {sessionExpired && !demo && <div className="notice notice-warning session-recovery" role="alert"><LockKeyhole size={18} /><div><strong>Sign in again to continue</strong><p>Your current work is still here. Sign in as {user?.email} in the new tab, then check your session before retrying.</p></div><a className="button button-secondary" href={session?.authMode === 'chatgpt' ? signInPath : '/login?switch_account=1'} target="_blank" rel="noreferrer">Sign in again <ArrowRight size={14} /></a><button className="button button-secondary" disabled={checkingSession} onClick={() => void checkSessionAgain()}>{checkingSession ? <Loader2 size={14} className="spin" /> : <Check size={14} />}Check session</button></div>}
          {draftWarning && <div className="notice notice-warning" role="alert">{draftWarning}</div>}
          {!session || busy ? <div className="loading-state"><Loader2 className="spin" size={24} /><p>{busy ? 'Opening your workspace…' : 'Preparing your workspace…'}</p></div> : view === 'overview' ? <>
            <div className="page-heading"><div><div className="eyebrow">A CLOSER LOOK MAKES THE DIFFERENCE</div><h1>Your annotation workspace<span className="heading-dot">.</span></h1><p>Thoughtful review. Reliable research. One document at a time.</p></div><span className="heading-art"><ClipboardCheck size={34} strokeWidth={1.25} /></span></div>
            <div className="overview-stats"><div><span className="stat-icon"><LayoutGrid size={19} /></span><div><strong>{projects.length.toString().padStart(2, '0')}</strong><span>Assigned projects</span></div></div><div><span className="stat-icon"><FileCheck2 size={19} /></span><div><strong>{projects.reduce((sum, p) => sum + p.submitted, 0).toString().padStart(2, '0')}</strong><span>{demo ? 'Previewed documents' : 'Submitted documents'}</span></div></div><div><span className="stat-icon"><ShieldCheck size={19} /></span><div><strong>Just you</strong><span>Your ratings remain private</span></div></div></div>
            <div className="section-heading"><h2>My projects <span>{projects.length}</span></h2><span>Only projects assigned to you appear here</span></div>
            {projects.length ? <div className="project-grid">{projects.map(p => <button key={p.id} className="project-card" onClick={() => openProject(p)}><span className={`project-card-icon ${p.id}`}><ProjectIcon id={p.id} size={26} /></span><span className="project-domain">{p.domain === 'chemistry' ? 'CHEMISTRY' : 'LEGAL RESEARCH'}</span><h3>{p.name}</h3><p>{p.description}</p><div className="project-card-progress"><span>{p.submitted} of {p.total} documents</span><span>{p.total ? Math.round(p.submitted / p.total * 100) : 0}%</span></div><div className="progress-track"><span style={{ width: `${p.total ? p.submitted / p.total * 100 : 0}%` }} /></div><div className="project-card-footer"><span>{p.qualified ? 'Continue annotation' : 'Complete qualification'}</span><ArrowRight size={17} /></div></button>)}</div> : <div className="welcome-card"><div className="welcome-icon"><BookOpen size={31} strokeWidth={1.3} /></div><h2>{user ? 'Your next project starts here' : 'Good research starts with a careful read.'}</h2><p>{user ? 'Your project administrator will assign your projects. Each project begins with its guideline and a short qualification test.' : 'Sign in to access your assigned projects, read the guidelines, and evaluate generated questions and answers in a focused workspace.'}</p><div className="welcome-actions">{!user && <a className="button" href={signInPath} target="_top">Sign in to your workspace <ArrowRight size={16} /></a>}{session?.isAdmin && <a className="button" href="/admin">Set up your projects <ArrowRight size={16} /></a>}<a className="button button-secondary" href="/?demo=1">Explore a sample workspace <ArrowRight size={16} /></a></div>{!session.configured && <p className="setup-caption">Administrator setup is required before projects can be assigned.</p>}</div>}
            <div className="workflow-note"><div><span>01</span><strong>Read & qualify</strong><p>Read your domain guidelines and answer every test question correctly.</p></div><div><span>02</span><strong>Review with care</strong><p>Assess the source, question, and answer using eight distinct criteria.</p></div><div><span>03</span><strong>Submit each document</strong><p>Each submission is saved individually. Wait for the server confirmation.</p></div></div>
          </> : (view === 'guidelines' || view === 'qualification') && project && projectData ? <Onboarding project={project} qualification={projectData.qualification} mode={view} demo={demo} questions={currentQuestions} checked={guidelineChecked} setChecked={setGuidelineChecked} answers={answers} setAnswer={(id, value) => setAnswers(previous => ({ ...previous, [id]: value }))} result={testResult} acknowledging={acknowledging} testing={testBusy} onContinue={acknowledgeGuideline} onSubmitTest={submitTest} onBack={() => navigate('guidelines')} onStart={() => openProject(project)} /> : view === 'submissions' && project ? <>
            <div className="page-heading compact-heading"><div><div className="eyebrow">{project.name.toUpperCase()} · YOUR WORK</div><h1>Every review, accounted for.</h1><p>{demo ? 'Preview submissions from this demo session.' : 'These are your own submitted annotations. Other annotators’ ratings are private.'}</p></div></div><div className="white-card submission-list"><div className="section-heading"><h2>My submissions</h2><span>{projectData?.documents.filter(d => d.submitted).length || 0} documents</span></div>{projectData?.documents.filter(d => d.submitted).length ? projectData.documents.filter(d => d.submitted).map(d => <button className="submission-row" key={d.id} onClick={() => openDocument(d)}><span className="submission-check"><CheckCircle2 size={20} /></span><div><strong>{d.title}</strong><small>{d.id}</small></div><span>{demo ? 'Previewed' : 'Submitted'}</span><ArrowRight size={17} /></button>) : <div className="empty-state"><FileCheck2 size={32} strokeWidth={1.2} /><h3>No submissions yet</h3><p>Submit your first document to see its saved annotation here.</p><button className="button button-secondary" onClick={() => navigate('workspace')}>Back to workspace <ArrowRight size={15} /></button></div>}</div>
          </> : project && !projectData?.qualification.passed ? <div className="empty-state"><LockKeyhole size={32} /><h2>Start with the guideline</h2><p>Complete the qualification test to unlock this project’s documents.</p><button className="button" onClick={() => setView(projectData?.qualification.guidelineRead ? 'qualification' : 'guidelines')}>Continue onboarding <ArrowRight size={16} /></button></div> : doc && draft && project ? <>
            <OnboardingSteps current={3} guidelineRead={true} passed={true} />
            <div className="annotation-heading"><div><div className="eyebrow"><span className={`project-dot ${project.id}`} />{project.name.toUpperCase()}<span className="eyebrow-divider">/</span>QUALITY EVALUATION</div><h1>A thoughtful review starts here.</h1><p>Read the context. Evaluate the question and answer. Make every score count.</p></div><button className="button button-secondary guideline-button" onClick={() => navigate('guidelines')}><BookOpen size={16} />Annotation guide <ArrowRight size={14} /></button></div>
            <div className="document-toolbar"><div className="document-counter"><FileText size={18} /><strong>Document {String(activeIndex + 1).padStart(2, '0')}</strong><span>of {String(projectData?.documents.length || 0).padStart(2, '0')}</span><span className="toolbar-divider" /><span className="doc-id">{doc.id}</span></div><div className="document-toolbar-right"><span className={`document-status ${receipt ? 'status-saved' : ''}`}>{receipt ? <CheckCircle2 size={14} /> : <span className="status-dot" />}{receipt ? (demo ? 'Preview complete' : 'Submitted') : draft.pending ? 'Save unconfirmed' : dirty ? 'Unsubmitted changes' : 'Ready for review'}</span><button className="icon-button bordered" aria-label="Previous document" disabled={activeIndex <= 0 || saving} onClick={() => projectData && openDocument(projectData.documents[activeIndex - 1])}><ArrowLeft size={15} /></button><button className="icon-button bordered" aria-label="Next document" disabled={!projectData || activeIndex >= projectData.documents.length - 1 || saving} onClick={() => projectData && openDocument(projectData.documents[activeIndex + 1])}><ArrowRight size={15} /></button></div></div>
            <div className="annotation-layout"><section className="document-column" aria-label="Document to evaluate"><article className="source-card"><div className="card-label"><span><span className="label-square"><FileText size={14} /></span>SOURCE TEXT</span><span className="subtle-badge">{isChemistry ? 'Research excerpt' : 'Document excerpt'}</span></div><h2>{doc.title}</h2>{demo && <p className="sample-disclaimer">Illustrative sample · not an original source document</p>}<div className="source-text">{doc.source.split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><div className="source-footer"><BookOpen size={13} />Use this text as the basis for your evaluation.</div></article><section className="qa-card"><div className="qa-label"><span className="qa-letter">Q</span><span>GENERATED QUESTION</span><span className="generated-badge"><Sparkles size={11} />Generated</span></div><p className="question-text">{doc.question}</p><div className="qa-divider" /><div className="qa-label answer-label"><span className="qa-letter">A</span><span>GENERATED ANSWER</span></div><p className="answer-text">{doc.answer}</p></section><div className="reading-tip"><span className="tip-icon"><CircleHelp size={17} /></span><p><strong>Judge each criterion independently.</strong> A strong answer on one dimension can still need improvement on another.</p></div></section>
            <section className="evaluation-column" aria-label="Annotation form"><div className="evaluation-card"><div className="evaluation-heading"><div><h2>Quality assessment <span>8 criteria</span></h2><p>Score each criterion from 1 to 5.</p></div><button className="icon-button" aria-label="Show scoring scale" title="Scoring scale" onClick={() => setShowScale(!showScale)}><CircleHelp size={18} /></button></div>{showScale && <div className="score-guide">{SCORE_NAMES.map((label, index) => <div key={label}><strong>{index + 1}</strong><span>{label}</span></div>)}<p>A 4 is fully successful. Reserve 5 for an exceptional strength you can explain.</p></div>}<div className="score-reminder"><MessageSquare size={14} /><span>{isChemistry ? 'Add a brief explanation for every score.' : 'Scores 1–3 need a reason. Explain exceptional 5s, too.'}</span></div><div className="criteria-list">{CRITERIA.map((criterion, index) => {
              const rating = draft.ratings.find(r => r.criterionId === criterion.id);
              const needsComment = requiredComment(rating?.score);
              const commentOpen = needsComment || expanded.includes(criterion.id) || !!rating?.comment;
              const description = isChemistry ? criterion.chemistryDescription || criterion.description : criterion.description;
              const hasScore = rating?.score !== undefined;
              return <fieldset className={`criterion ${hasScore ? 'criterion-scored' : ''}`} key={criterion.id} id={`criterion-${criterion.id}`} disabled={saving || !!receipt || draft.pending}><legend><span className="criterion-number">{String(index + 1).padStart(2, '0')}</span><span>{criterion.name}</span><button className="criterion-help" type="button" title={description} aria-label={`Read guidance for ${criterion.name}`} aria-expanded={helpCriterion === criterion.id} onClick={() => setHelpCriterion(helpCriterion === criterion.id ? null : criterion.id)}><CircleHelp size={13} /></button>{hasScore && <Check size={13} className="criterion-check" />}</legend><p className="criterion-description">{criterion.question}</p>{helpCriterion === criterion.id && <p className="criterion-guidance">{description}</p>}<div className="rating-line"><div className="score-options" role="radiogroup" aria-label={`${criterion.name} score`}>{[1, 2, 3, 4, 5].map(score => <label key={score} className={`score-option ${rating?.score === score ? 'selected' : ''} ${rating?.score === score && score <= 3 ? 'low-score' : ''}`} title={`${score} — ${SCORE_NAMES[score - 1]}`}><input type="radio" name={`rating-${criterion.id}`} value={score} checked={rating?.score === score} onChange={() => updateRating(criterion.id, { score })} /><span>{score}</span></label>)}</div><button type="button" className={`cannot-assess ${rating && rating.score === null ? 'selected' : ''}`} aria-pressed={rating?.score === null} onClick={() => updateRating(criterion.id, { score: null })}>Cannot assess</button><button type="button" className={`comment-toggle ${commentOpen ? 'is-open' : ''}`} title="Add a criterion comment" aria-label={`Comment on ${criterion.name}`} onClick={() => setExpanded(prev => prev.includes(criterion.id) ? prev.filter(id => id !== criterion.id) : [...prev, criterion.id])}><MessageSquare size={15} /></button></div>{criterion.id === 'numerical_fidelity' && <label className="na-option"><input type="checkbox" checked={rating?.score === 4 && rating.comment.toLowerCase() === 'not applicable'} onChange={event => updateRating(criterion.id, event.target.checked ? { score: 4, comment: 'not applicable' } : { score: 4, comment: '' })} />No relevant numbers or references (score 4)</label>}{commentOpen && <div className="criterion-comment"><label htmlFor={`comment-${criterion.id}`}>{rating?.score === 5 ? 'What makes this exceptional?' : rating?.score === null ? 'What prevents you from assessing this?' : rating && rating.score !== undefined && rating.score !== null && rating.score <= 3 ? 'What needs to be improved?' : 'Reason for this score'}{needsComment && <span>Required</span>}</label><textarea id={`comment-${criterion.id}`} value={rating?.comment || ''} rows={2} placeholder={rating?.score === 5 ? 'Explain the exceptional strength…' : 'Explain your reasoning and any needed correction…'} onChange={event => updateRating(criterion.id, { comment: event.target.value })} maxLength={10000} /></div>}</fieldset>;
            })}</div><div className="document-comment"><label htmlFor="document-comment"><MessageSquare size={15} />Overall document comment <span>Optional</span></label><textarea id="document-comment" placeholder="Anything else we should know about this question–answer pair?" rows={3} value={draft.comment} maxLength={20000} disabled={saving || !!receipt || draft.pending} onChange={event => { setDraft({ ...draft, comment: event.target.value }); setDirty(true); }} /></div></div>
            <div className={`submission-panel ${receipt ? 'submission-panel-saved' : ''}`}><div className="submission-progress"><span>{receipt ? <CheckCircle2 size={19} /> : <ShieldCheck size={19} />}</span><div><strong>{receipt ? demo ? 'Demo preview complete' : 'Saved to server' : draft.pending ? 'Save awaiting confirmation' : `${completedRatings} of 8 criteria scored`}</strong><p>{receipt ? `${new Date(receipt.savedAt).toLocaleString()}${demo ? ' · not a real submission' : ''}` : draft.pending ? 'Your answers are held unchanged. Retry safely to confirm.' : 'Submit saves this document immediately.'}</p></div>{receipt && <span className="receipt-label" title={receipt.id}>Receipt {receipt.id.slice(0, 8)}</span>}</div>{receipt ? <button className="button submit-button" disabled={!projectData || activeIndex >= projectData.documents.length - 1} onClick={() => projectData && openDocument(projectData.documents[activeIndex + 1])}>{activeIndex >= (projectData?.documents.length || 0) - 1 ? 'Last document reviewed' : 'Continue to next document'}<ArrowRight size={17} /></button> : <button className="button submit-button" disabled={saving || sessionExpired} onClick={submit}>{saving ? <Loader2 size={17} className="spin" /> : <CheckCheck size={17} />}{saving ? 'Saving your annotation…' : demo ? 'Preview submission' : draft.pending ? 'Retry & confirm save' : 'Submit annotation'}{!saving && <ArrowRight size={17} />}</button>}<p className="save-assurance">{receipt ? demo ? 'Demo previews are cleared when you reload this page.' : 'Your submitted review is locked to preserve the saved record.' : 'Wait for confirmation before continuing to the next document.'}</p></div></section></div>
          </> : <div className="empty-state"><FileText size={35} strokeWidth={1.2} /><h2>No documents to review yet</h2><p>Your administrator can import the question–answer dataset for this project.</p></div>}
        </main><footer className="app-footer"><span>Annotation Studio</span><span>Independent judgment. Better data.</span><span><LockKeyhole size={11} />Your work stays private</span></footer>
      </div>
    </div>
  );
}
