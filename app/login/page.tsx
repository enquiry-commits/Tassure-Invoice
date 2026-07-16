import GoogleLoginButton from '@/components/GoogleLoginButton';
import { signInWithGoogle } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login-page-simple">
      <section className="login-box-wrap">
        <header className="login-heading">
          <h1>Sign In</h1>
          <p>Tassure Review System</p>
        </header>
        <div className="login-card-simple">
          <div className="login-instruction">
            <strong>Use your company Google account</strong>
            <span>使用公司 Google 账号登录</span>
          </div>
          {error && (
            <div className="login-error-simple" role="alert">
              {error === 'domain' ? 'This Google account is not approved for this system.' : 'Google sign-in was not completed. Please try again.'}
            </div>
          )}
          <form action={signInWithGoogle}><GoogleLoginButton /></form>
          <p className="login-domain-note">Only approved Tassure Google accounts can access this system.</p>
        </div>
      </section>
    </main>
  );
}
