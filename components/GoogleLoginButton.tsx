'use client';

import { useFormStatus } from 'react-dom';
import { LoaderCircle } from 'lucide-react';

export default function GoogleLoginButton() {
  const { pending } = useFormStatus();
  return (
    <button className="google-login-button" type="submit" disabled={pending}>
      {pending ? <LoaderCircle size={20} className="login-spinner" /> : (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.29-2.65l-3.57-2.77c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.94-6.16-4.54H2.16v2.84A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.06H2.16A11 11 0 0 0 1 12c0 1.77.42 3.44 1.16 4.94l3.68-2.84Z" />
          <path fill="#EA4335" d="M12 5.36c1.62 0 3.06.56 4.2 1.64l3.17-3.17A10.6 10.6 0 0 0 12 1a11 11 0 0 0-9.84 6.06L5.84 9.9C6.71 7.3 9.14 5.36 12 5.36Z" />
        </svg>
      )}
      <span>{pending ? 'Connecting to Google...' : 'Sign in with Google'}</span>
    </button>
  );
}
