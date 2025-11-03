import { useState, useEffect, useCallback } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [activeUser, setActiveUser] = useState(() => localStorage.getItem('activeUser') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tracks, setTracks] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [banner, setBanner] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isFetchingTracks, setIsFetchingTracks] = useState(false);

  const isLoggedIn = Boolean(token);

  const closeBanner = useCallback(() => setBanner(null), []);
  const showBanner = useCallback((text, type = 'info') => setBanner({ text, type }), []);

  const fetchTracks = useCallback(async () => {
    setIsFetchingTracks(true);
    try {
      if (token) {
        const importResponse = await fetch(`${API_URL}/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });

        if (!importResponse.ok) {
          const payload = await importResponse.json().catch(() => ({}));
          if (importResponse.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('activeUser');
            setToken('');
            setActiveUser('');
            setTracks([]);
            setCurrentTrack(null);
            showBanner('Session expired. Please sign in again.', 'error');
            return;
          }
          showBanner(payload.error || 'Unable to refresh library.', 'error');
        }
      }

      const res = await fetch(`${API_URL}/tracks`);
      if (!res.ok) {
        throw new Error('Unable to load tracks.');
      }

      const data = await res.json();
      const nextTracks = Array.isArray(data) ? data : [];
      setTracks(nextTracks);
      setCurrentTrack((previous) => {
        if (!previous) return null;
        return nextTracks.find((track) => track._id === previous._id) ?? null;
      });
    } catch (error) {
      showBanner(error.message, 'error');
    } finally {
      setIsFetchingTracks(false);
    }
  }, [token, showBanner]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchTracks();
    } else {
      setTracks([]);
      setCurrentTrack(null);
    }
  }, [isLoggedIn, fetchTracks]);

  const login = async (event) => {
    event.preventDefault();
    if (!username || !password) {
      showBanner('Enter username and password to continue.', 'error');
      return;
    }

    setIsLoggingIn(true);
    showBanner('Signing you in...', 'info');

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Unable to log in. Check your credentials.');
      }

      setToken(data.token);
      setActiveUser(username);
      localStorage.setItem('token', data.token);
      localStorage.setItem('activeUser', username);
      setUsername('');
      setPassword('');
      showBanner(`Welcome back, ${username}!`, 'success');
    } catch (error) {
      showBanner(error.message, 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => {
    setToken('');
    setActiveUser('');
    localStorage.removeItem('token');
    localStorage.removeItem('activeUser');
    setTracks([]);
    setCurrentTrack(null);
    showBanner('You have been signed out.', 'info');
  };

  const playTrack = (track) => {
    setCurrentTrack(track);
  };

  return (
    <div className="app">
      {banner && (
        <div className={`banner banner--${banner.type}`} role="alert">
          <span>{banner.text}</span>
          <button className="banner-close" type="button" onClick={closeBanner} aria-label="Dismiss notification">
            x
          </button>
        </div>
      )}

      {!isLoggedIn ? (
        <main className="auth-page">
          <div className="auth-card">
            <h1>Music Player</h1>
            <p className="auth-subtitle">Sign in to manage and play your music library.</p>
            <form className="auth-form" onSubmit={login}>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin"
              />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="password"
              />

              <button className="btn btn-primary" type="submit" disabled={isLoggingIn}>
                {isLoggingIn ? 'Signing in...' : 'Sign in'}
              </button>
              <p className="hint">Hint: admin / password</p>
            </form>
          </div>
        </main>
      ) : (
        <div className="app-shell">
          <header className="app-header">
            <div>
              <h1>Music Player</h1>
            </div>
            <div className="header-actions">
              <span className="user-chip">{activeUser || 'User'}</span>
              <button className="btn btn-ghost" type="button" onClick={logout}>
                Log out
              </button>
            </div>
          </header>

          <main className="dashboard">
            <section className="panel tracks-panel">
              <div className="panel-heading">
                <h2>Tracks</h2>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={fetchTracks}
                  disabled={isFetchingTracks}
                >
                  {isFetchingTracks ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {!tracks.length && !isFetchingTracks ? (
                <p className="panel-text">No tracks yet. Add audio files to the database and refresh.</p>
              ) : (
                <ul className="tracks-list">
                  {tracks.map((track) => (
                    <li key={track._id}>
                      <div>
                        <p className="track-title">{track.title || 'Untitled track'}</p>
                        <p className="track-artist">{track.artist || 'Unknown artist'}</p>
                      </div>
                      <button className="btn btn-secondary" type="button" onClick={() => playTrack(track)}>
                        Play
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </main>

          {currentTrack && (
            <footer className="now-playing">
              <div>
                <p className="now-playing-label">Now playing</p>
                <p className="track-title">{currentTrack.title || 'Untitled track'}</p>
                <p className="track-artist">{currentTrack.artist || 'Unknown artist'}</p>
              </div>
              <audio controls autoPlay src={`${API_URL}/track/${currentTrack._id}`} />
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
