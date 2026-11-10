'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, CheckCircle2, ExternalLink, FileText, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';

export type Qualification = {
  passed: boolean;
  ready: boolean;
  version: string | null;
  guidelineRead: boolean;
  guidelineReadAt: string | null;
  passedAt: string | null;
};
export type TestQuestion = { id: string; question: string; options: { value: string; label: string }[] };
export type TestResult = { passed: boolean; correct: number; total: number };

type Props = {
  project: { id: string; name: string; domain: string };
  qualification: Qualification;
  mode: 'guidelines' | 'qualification';
  demo: boolean;
  questions: TestQuestion[];
  checked: boolean;
  setChecked: (checked: boolean) => void;
  answers: Record<string, string>;
  setAnswer: (questionId: string, value: string) => void;
  result: TestResult | null;
  acknowledging: boolean;
  testing: boolean;
  checkingAvailability: boolean;
  onContinue: () => void;
  onSubmitTest: () => void;
  onCheckAvailability: () => void;
  onBack: () => void;
  onStart: () => void;
};

export function OnboardingSteps({ current, guidelineRead, passed }: { current: 1 | 2 | 3; guidelineRead: boolean; passed: boolean }) {
  const steps = [
    { label: 'Read the guideline', complete: guidelineRead, number: 1 },
    { label: 'Pass the qualification test', complete: passed, number: 2 },
    { label: 'Start annotation', complete: false, number: 3 },
  ];
  return <ol className="onboarding-steps" aria-label="Project onboarding progress">{steps.map(step => <li key={step.number} className={`${step.number === current ? 'current' : ''} ${step.complete ? 'complete' : ''}`} aria-current={step.number === current ? 'step' : undefined}><span className="onboarding-step-number">{step.complete ? <Check size={14} /> : step.number}</span><span>{step.label}</span>{step.number < 3 && <ArrowRight size={14} className="onboarding-step-arrow" />}</li>)}</ol>;
}

export default function Onboarding({ project, qualification, mode, demo, questions, checked, setChecked, answers, setAnswer, result, acknowledging, testing, checkingAvailability, onContinue, onSubmitTest, onCheckAvailability, onBack, onStart }: Props) {
  const resultRef = useRef<HTMLDivElement>(null);
  const chemistry = project.domain === 'chemistry';
  const pdfUrl = demo ? `/api/demo/guideline/${chemistry ? 'chemistry' : 'legal'}` : `/api/projects/${project.id}/guideline`;
  const answered = questions.filter(q => !!answers[q.id]).length;
  const unanswered = questions.filter(q => !answers[q.id]).map(q => q.id);
  const passed = qualification.passed;
  const showGuideline = mode === 'guidelines' || !qualification.guidelineRead;

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [result]);

  return <>
    <div className="page-heading compact-heading onboarding-heading">
      <div><div className="eyebrow">{project.name.toUpperCase()} · {passed ? 'GUIDELINE REFERENCE' : 'GETTING STARTED'}</div>
        <h1>{showGuideline ? 'Read the annotation guideline.' : passed ? 'You’re ready to annotate.' : 'Complete the qualification test.'}</h1>
        <p>{showGuideline ? passed ? 'Keep the guideline handy while reviewing. Your qualification is already complete.' : 'Read the complete guideline below before continuing to the test.' : passed ? 'All ten answers are correct. This project is now unlocked for you.' : 'Answer all ten questions correctly to unlock this project’s annotation documents.'}</p>
      </div>
      <a className="button button-secondary" href={pdfUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open guideline PDF</a>
    </div>
    <OnboardingSteps current={showGuideline ? 1 : passed ? 3 : 2} guidelineRead={qualification.guidelineRead} passed={passed} />
    {showGuideline ? <>
      {passed && <div className="notice notice-success"><ShieldCheck size={18} /><span>{demo ? 'You completed this project’s demo qualification in this browser session.' : 'You have already passed this project’s qualification. You do not need to take the test again.'}</span></div>}
      <section className="guideline-reader" aria-label={`${chemistry ? 'Chemistry' : 'Legal'} annotation guideline`}>
        <div className="guideline-reader-toolbar"><div><FileText size={17} /><strong>{chemistry ? 'Chemistry' : 'Legal'} annotation guidelines</strong><span>4 pages</span></div><a href={pdfUrl} target="_blank" rel="noreferrer">Open in a new tab <ExternalLink size={13} /></a></div>
        <iframe className="guideline-pdf" src={`${pdfUrl}#view=FitH`} title={`${chemistry ? 'Chemistry' : 'Legal'} annotation guideline PDF`} />
        <div className="guideline-reader-fallback"><BookOpen size={16} /><p>If the PDF does not appear or is difficult to read, <a href={pdfUrl} target="_blank" rel="noreferrer">open the full guideline in a new tab</a>. Read all four pages before continuing.</p></div>
      </section>
      <div className="guideline-reading-reminders"><strong>As you read, pay attention to:</strong><ul><li>The eight criteria and the difference between scores 4 and 5.</li><li>When to explain a score, use “not applicable,” or choose “cannot assess.”</li><li>{chemistry ? 'The requirement to give a brief reason for every chemistry score.' : 'How to assess each criterion independently and identify needed corrections.'}</li></ul></div>
      <section className="guideline-acknowledgement">
        {passed ? <><div><CheckCircle2 size={21} /><div><strong>Qualification complete</strong><p>{demo ? 'Demo progress is kept only in this browser session.' : 'Your successful qualification is saved for this project.'}</p></div></div><button className="button" onClick={onStart}>Return to annotation <ArrowRight size={16} /></button></> : <>
          {qualification.guidelineRead ? <div className="guideline-already-read"><CheckCircle2 size={21} /><div><strong>Guideline acknowledged</strong><p>You can revisit it at any time while completing the test.</p></div></div> : <label className="guideline-read-checkbox"><input type="checkbox" checked={checked} disabled={acknowledging} onChange={event => setChecked(event.target.checked)} /><span><strong>I have read the full guideline and understand the scoring rules.</strong><small>Continue when you are ready to answer the ten qualification questions.</small></span></label>}
          <button className="button" disabled={acknowledging || (!checked && !qualification.guidelineRead)} onClick={onContinue}>{acknowledging ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{acknowledging ? qualification.guidelineRead ? 'Opening qualification test…' : 'Saving acknowledgement…' : 'Continue to qualification test'}{!acknowledging && <ArrowRight size={16} />}</button>
        </>}
      </section>
    </> : passed ? <section className="qualification-complete white-card" ref={resultRef} role="status"><div className="qualification-complete-icon"><CheckCheck size={32} /></div><span className="eyebrow">QUALIFICATION COMPLETE</span><h2>10 out of 10. You’re ready.</h2><p>{demo ? 'Your demo qualification is complete for this project. The following documents are hypothetical examples; preview submissions are not saved to the server.' : 'Your successful qualification has been saved. You will go straight to annotation whenever you return to this project.'}</p><button className="button" onClick={onStart}>Start annotation <ArrowRight size={17} /></button></section> : <section className="qualification-card qualification-screen">
      <div className="qualification-heading"><span className="step-badge">02</span><div><h2>Qualification test</h2><p>Open-book · 10 questions · 100% required</p></div><span className="subtle-badge">{answered}/10 answered</span></div>
      <p className="qualification-instructions">Choose one answer for each question. You may refer to the guideline while working. Annotation documents remain locked until all ten answers are correct.</p>
      {result && <div className="notice notice-warning" role="status" ref={resultRef}><LockKeyhole size={17} /><span>{result.correct} of {result.total} correct. Review the guideline and try again. All 10 answers must be correct before annotation is unlocked.</span></div>}
      {questions.map((q, index) => <fieldset className="test-question" key={q.id} disabled={testing}><legend><span>{String(index + 1).padStart(2, '0')}</span>{q.question}</legend>{q.options.map(option => <label className={`test-option ${answers[q.id] === option.value ? 'selected' : ''}`} key={option.value}><input type="radio" name={`question-${q.id}`} value={option.value} checked={answers[q.id] === option.value} onChange={() => setAnswer(q.id, option.value)} /><span className="option-letter">{option.value}</span><span>{option.label}</span></label>)}</fieldset>)}
      {questions.length !== 10 ? <div className="notice notice-warning" role="status">All ten test questions could not be loaded. Check availability to load them again.</div> : unanswered.length > 0 && <p className="qualification-instructions" role="status">Answer {unanswered.length === 1 ? 'question' : 'questions'} {unanswered.join(', ')} to enable submission.</p>}
      {!qualification.ready && <div className="notice notice-warning" role="status"><LockKeyhole size={17} /><span>The answer key was unavailable when this test opened. Check availability or submit your completed answers to check again. Your selections will stay here if the administrator still needs to set up the key.</span></div>}
      <div className="qualification-footer" style={{ flexWrap: 'wrap' }}><button className="button button-secondary" disabled={testing || checkingAvailability} onClick={onBack}><ArrowLeft size={15} />Back to guideline</button>{!demo && (!qualification.ready || questions.length !== 10) && <button className="button button-secondary" disabled={testing || checkingAvailability} onClick={onCheckAvailability}>{checkingAvailability ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}{checkingAvailability ? 'Checking availability…' : 'Check availability'}</button>}<button className="button" onClick={onSubmitTest} disabled={questions.length !== 10 || answered !== 10 || testing || checkingAvailability}>{testing ? <Loader2 size={16} className="spin" /> : <CheckCheck size={16} />}{testing ? 'Checking answers…' : 'Submit qualification test'}</button></div>
    </section>}
  </>;
}
