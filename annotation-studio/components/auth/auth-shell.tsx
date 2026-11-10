import type { ReactNode } from 'react';
import { BookOpen, CheckCheck, ShieldCheck } from 'lucide-react';

export default function AuthShell({ children }: { children: ReactNode }) {
  return <main className="auth-page">
    <section className="auth-introduction" aria-label="Annotation Studio">
      <a className="brand auth-brand" href="/"><span className="brand-symbol"><span /><span /><span /></span><span>annotation<span className="brand-studio">STUDIO</span></span></a>
      <div className="auth-intro-content"><span className="eyebrow">A CLOSER LOOK MAKES THE DIFFERENCE</span><h1>Thoughtful review.<br />Better research.</h1><p>A focused workspace for reviewing generated questions and answers, one document at a time.</p><div className="auth-feature"><BookOpen size={20} /><div><strong>A shared standard</strong><span>Read the guideline, pass the test, and start reviewing.</span></div></div><div className="auth-feature"><ShieldCheck size={20} /><div><strong>Independent by design</strong><span>Annotators see their assigned project and their own ratings.</span></div></div><div className="auth-feature"><CheckCheck size={20} /><div><strong>Every submission counts</strong><span>Each document is saved when you submit it.</span></div></div></div>
      <span className="auth-intro-footer">LEGAL RESEARCH <span>·</span> CHEMISTRY</span>
    </section>
    <section className="auth-form-column">{children}<footer className="auth-page-footer"><ShieldCheck size={13} />Private research workspace</footer></section>
  </main>;
}
