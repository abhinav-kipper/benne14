import { Landing } from './Landing';

// The plain address has no page of its own: nothing here lists the shop's screens. Each device
// opens its own address (/kiosk, /kitchen, /board, /admin) and installs that as an app.
export const metadata = { title: 'benne 14', robots: { index: false } };

export default function Home() {
  return <Landing />;
}
