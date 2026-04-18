import { redirect } from 'next/navigation';

// Magic-link auth means signup and login are the same flow. Collapse /signup into /login
// so we have a single page to maintain.
export default function SignupPage() {
  redirect('/login');
}
