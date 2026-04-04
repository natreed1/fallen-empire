import type { Metadata } from 'next';
import { Cinzel_Decorative, MedievalSharp } from 'next/font/google';
import './globals.css';

const cinzelDecorative = Cinzel_Decorative({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--font-cinzel-decorative',
});

const medievalSharp = MedievalSharp({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-medieval',
});

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
      <body className={`${cinzelDecorative.variable} ${medievalSharp.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
