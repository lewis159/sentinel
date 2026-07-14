import { redirect } from 'next/navigation';

// v1 is retired: the root path now sends operators straight to the v2 console.
// (The middleware also 308-redirects '/' → '/v2', but this is the belt-and-braces
// server redirect for any request that reaches the page directly.)
export default function Page() {
  redirect('/v2');
}
