import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fallen Empire — Strategy Map',
  description: 'A procedurally generated hex-based strategy game map',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
