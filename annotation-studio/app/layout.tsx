import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Annotation Studio · A closer look',
  description: 'A focused, private workspace for evaluating generated questions and answers.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
