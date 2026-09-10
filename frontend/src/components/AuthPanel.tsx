import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import type { AuthMode } from '../types'

type GoogleCredentialResponse = {
  credential?: string
}

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }) => void
  renderButton: (
    element: HTMLElement,
    options: {
      theme?: 'outline' | 'filled_black' | 'filled_blue'
      size?: 'large' | 'medium' | 'small'
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
      shape?: 'rectangular' | 'pill' | 'circle' | 'square'
      width?: number
      logo_alignment?: 'left' | 'center'
    },
  ) => void
}

type GoogleAuthResult =
  | {
      status: 'needs_completion'
      email: string
      suggestedUsername: string
    }
  | {
      status: 'authenticated'
    }

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleAccountsId
      }
    }
  }
}

const GOOGLE_IDENTITY_SCRIPT_ID = 'google-identity-services-script'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
  /\/$/,
  '',
)

function authApiUrl(path: string): string {
  if (apiBaseUrl) {
    return `${apiBaseUrl}${path}`
  }
  return path
}

type LoginValues = {
  identifier: string
  password: string
}

type SignupValues = {
  username: string
  email: string
  password: string
  confirmPassword: string
}

type GoogleCompletionValues = {
  username: string
  password: string
  confirmPassword: string
}

type AuthPanelProps = {
  mode: AuthMode
  notice?: string
  onModeChange: (mode: AuthMode) => void
  onLogin: (values: LoginValues) => Promise<void>
  onSignup: (values: SignupValues) => Promise<void>
  onGoogleAuth: (credential: string, mode: AuthMode) => Promise<GoogleAuthResult>
  onCompleteGoogleSignup: (values: GoogleCompletionValues) => Promise<void>
}

export function AuthPanel({
  mode,
  notice = '',
  onModeChange,
  onLogin,
  onSignup,
  onGoogleAuth,
  onCompleteGoogleSignup,
}: AuthPanelProps) {
  const [googleClientId, setGoogleClientId] = useState(
    () => (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '',
  )
  const hasGoogleClientId = googleClientId.length > 0
  const [loginValues, setLoginValues] = useState<LoginValues>({
    identifier: '',
    password: '',
  })
  const [signupValues, setSignupValues] = useState<SignupValues>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [googleCompletion, setGoogleCompletion] = useState<{
    email: string
    suggestedUsername: string
  } | null>(null)
  const [googleCompletionValues, setGoogleCompletionValues] =
    useState<GoogleCompletionValues>({
      username: '',
      password: '',
      confirmPassword: '',
    })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [isCompletingGoogleSignup, setIsCompletingGoogleSignup] = useState(false)
  const [isGoogleScriptReady, setIsGoogleScriptReady] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const googleAuthInFlightRef = useRef(false)
  const isCompleting = googleCompletion !== null
  const isBusy = isSubmitting || isGoogleSubmitting || isCompletingGoogleSignup

  useEffect(() => {
    setError('')
  }, [mode, notice])

  useEffect(() => {
    setGoogleCompletion(null)
    setGoogleCompletionValues({
      username: '',
      password: '',
      confirmPassword: '',
    })
  }, [mode])

  useEffect(() => {
    if (googleClientId) {
      return
    }

    let isCancelled = false

    fetch(authApiUrl('/api/auth/google/client-id'), {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) {
          return ''
        }
        const payload = (await response.json()) as { clientId?: unknown }
        return typeof payload.clientId === 'string' ? payload.clientId.trim() : ''
      })
      .then((clientId) => {
        if (!isCancelled && clientId) {
          setGoogleClientId(clientId)
        }
      })
      .catch(() => {
        // Keep silent; normal login/signup remains available.
      })

    return () => {
      isCancelled = true
    }
  }, [googleClientId])

  useEffect(() => {
    if (!hasGoogleClientId) {
      return
    }

    let isCancelled = false

    const markReady = () => {
      if (isCancelled) {
        return
      }
      setIsGoogleScriptReady(Boolean(window.google?.accounts?.id))
    }

    const handleScriptError = () => {
      if (isCancelled) {
        return
      }
      setError('Unable to load Google sign-in right now.')
      setIsGoogleScriptReady(false)
    }

    const existingScript = document.getElementById(
      GOOGLE_IDENTITY_SCRIPT_ID,
    ) as HTMLScriptElement | null
    const script = existingScript ?? document.createElement('script')

    if (!existingScript) {
      script.id = GOOGLE_IDENTITY_SCRIPT_ID
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }

    script.addEventListener('load', markReady)
    script.addEventListener('error', handleScriptError)

    markReady()

    return () => {
      isCancelled = true
      script.removeEventListener('load', markReady)
      script.removeEventListener('error', handleScriptError)
    }
  }, [hasGoogleClientId])

  const handleGoogleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      const credential =
        typeof response.credential === 'string' ? response.credential.trim() : ''
      if (!credential) {
        setError('Google sign-in did not return a valid credential.')
        return
      }

      if (googleAuthInFlightRef.current || isSubmitting || isCompletingGoogleSignup) {
        return
      }

      googleAuthInFlightRef.current = true
      setError('')
      setIsGoogleSubmitting(true)
      try {
        const result = await onGoogleAuth(credential, mode)
        if (result.status === 'needs_completion') {
          setGoogleCompletion({
            email: result.email,
            suggestedUsername: result.suggestedUsername,
          })
          setGoogleCompletionValues({
            username: result.suggestedUsername,
            password: '',
            confirmPassword: '',
          })
        }
      } catch (submitError: unknown) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : 'Unable to sign in with Google right now.',
        )
      } finally {
        googleAuthInFlightRef.current = false
        setIsGoogleSubmitting(false)
      }
    },
    [isCompletingGoogleSignup, isSubmitting, mode, onGoogleAuth],
  )

  useEffect(() => {
    if (isCompleting || !hasGoogleClientId || !isGoogleScriptReady || !googleButtonRef.current) {
      return
    }

    const googleAccounts = window.google?.accounts?.id
    if (!googleAccounts) {
      return
    }

    googleAccounts.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
    })
    googleButtonRef.current.innerHTML = ''
    const availableWidth = Math.floor(
      googleButtonRef.current.getBoundingClientRect().width || 330,
    )
    const buttonWidth = Math.max(220, Math.min(330, availableWidth))
    googleAccounts.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      text: mode === 'signup' ? 'signup_with' : 'continue_with',
      shape: 'pill',
      width: buttonWidth,
      logo_alignment: 'left',
    })
  }, [
    googleClientId,
    handleGoogleCredential,
    hasGoogleClientId,
    isCompleting,
    isGoogleScriptReady,
    mode,
  ])

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy) {
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      await onLogin(loginValues)
      setLoginValues({ identifier: '', password: '' })
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to log in right now.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy) {
      return
    }

    if (signupValues.password !== signupValues.confirmPassword) {
      setError('Password confirmation does not match.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      await onSignup(signupValues)
      setSignupValues({
        username: '',
        email: '',
        password: '',
        confirmPassword: '',
      })
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to create your account right now.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogleCompletionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy) {
      return
    }

    if (googleCompletionValues.password !== googleCompletionValues.confirmPassword) {
      setError('Password confirmation does not match.')
      return
    }

    setError('')
    setIsCompletingGoogleSignup(true)
    try {
      await onCompleteGoogleSignup(googleCompletionValues)
      setGoogleCompletion(null)
      setGoogleCompletionValues({
        username: '',
        password: '',
        confirmPassword: '',
      })
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to finish your account setup right now.',
      )
    } finally {
      setIsCompletingGoogleSignup(false)
    }
  }

  return (
    <aside className="auth-card">
      <div className="auth-card-header">
        <h2>
          {isCompleting
            ? 'Finish your account'
            : mode === 'login'
              ? 'Log In'
              : 'Create Account'}
        </h2>
      </div>

      {!isCompleting && (
        <div className="auth-tabs" role="tablist" aria-label="Authentication options">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => onModeChange('login')}
          >
            Log In
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => onModeChange('signup')}
          >
            Create Account
          </button>
        </div>
      )}

      {notice && !isCompleting && <p className="auth-notice">{notice}</p>}
      {error && <p className="auth-error">{error}</p>}

      {isCompleting ? (
        <form className="auth-form" onSubmit={handleGoogleCompletionSubmit}>
          <p className="auth-helper-text">
            Google verified email: <strong>{googleCompletion?.email ?? ''}</strong>
          </p>
          <label className="auth-field">
            <span>Username</span>
            <input
              value={googleCompletionValues.username}
              onChange={(event) =>
                setGoogleCompletionValues((current) => ({
                  ...current,
                  username: event.target.value,
                }))
              }
              autoComplete="username"
              placeholder="Choose a username"
              disabled={isBusy}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={googleCompletionValues.password}
              onChange={(event) =>
                setGoogleCompletionValues((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              autoComplete="new-password"
              placeholder="Create a password"
              disabled={isBusy}
            />
          </label>
          <label className="auth-field">
            <span>Confirm password</span>
            <input
              type="password"
              value={googleCompletionValues.confirmPassword}
              onChange={(event) =>
                setGoogleCompletionValues((current) => ({
                  ...current,
                  confirmPassword: event.target.value,
                }))
              }
              autoComplete="new-password"
              placeholder="Repeat your password"
              disabled={isBusy}
            />
          </label>
          <button type="submit" disabled={isBusy}>
            {isCompletingGoogleSignup ? 'Finishing...' : 'Finish Account'}
          </button>
        </form>
      ) : mode === 'login' ? (
        <form className="auth-form" onSubmit={handleLoginSubmit}>
          <label className="auth-field">
            <span>Username or email</span>
            <input
              value={loginValues.identifier}
              onChange={(event) =>
                setLoginValues((current) => ({
                  ...current,
                  identifier: event.target.value,
                }))
              }
              autoComplete="username"
              placeholder="jane_doe or jane@example.com"
              disabled={isBusy}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={loginValues.password}
              onChange={(event) =>
                setLoginValues((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              autoComplete="current-password"
              placeholder="Enter your password"
              disabled={isBusy}
            />
          </label>
          <button type="submit" disabled={isBusy}>
            {isSubmitting ? 'Logging In...' : 'Log In'}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={handleSignupSubmit}>
          <label className="auth-field">
            <span>Username</span>
            <input
              value={signupValues.username}
              onChange={(event) =>
                setSignupValues((current) => ({
                  ...current,
                  username: event.target.value,
                }))
              }
              autoComplete="username"
              placeholder="Choose a username"
              disabled={isBusy}
            />
          </label>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={signupValues.email}
              onChange={(event) =>
                setSignupValues((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
              autoComplete="email"
              placeholder="name@example.com"
              disabled={isBusy}
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={signupValues.password}
              onChange={(event) =>
                setSignupValues((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              autoComplete="new-password"
              placeholder="Create a password"
              disabled={isBusy}
            />
          </label>
          <label className="auth-field">
            <span>Confirm password</span>
            <input
              type="password"
              value={signupValues.confirmPassword}
              onChange={(event) =>
                setSignupValues((current) => ({
                  ...current,
                  confirmPassword: event.target.value,
                }))
              }
              autoComplete="new-password"
              placeholder="Repeat your password"
              disabled={isBusy}
            />
          </label>
          <button type="submit" disabled={isBusy}>
            {isSubmitting ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>
      )}

      {!isCompleting && hasGoogleClientId && (
        <>
          <div className="auth-divider" aria-hidden="true">
            <span>or</span>
          </div>

          <div className="auth-google">
            <div className="auth-google-button" ref={googleButtonRef} />
            {!isGoogleScriptReady && (
              <p className="auth-google-hint">Loading Google sign-in...</p>
            )}
            {isGoogleSubmitting && (
              <p className="auth-google-status">Signing in with Google...</p>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
