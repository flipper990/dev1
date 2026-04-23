// ── frontend/pages/_app.tsx ──
;

var { Provider } = window.__s_react_redux;
;

function App({ Component, pageProps }: AppProps) {
  return (
    <Provider store={store}>
      <Component {...pageProps} />
    </Provider>
  );
}

var __d_frontend_pages__app = App;


// ── frontend/pages/login.tsx ──
var { useState } = React;
var { useDispatch } = window.__s_react_redux;
;
var { useRouter } = window.__s_next_router;

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const dispatch = useDispatch();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await dispatch<any>(login({ email, password }));
      router.push('/feed');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-md w-80">
        <h2 className="text-2xl font-bold mb-4">Login</h2>
        {error && <div className="text-red-600 mb-2">{error}</div>}
        <input
          type="email"
          placeholder="Email"
          className="border p-2 mb-2 w-full"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          className="border p-2 mb-4 w-full"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded w-full">Login</button>
      </form>
    </div>
  );
}

var __d_frontend_pages_login = Login;


// ── frontend/pages/register.tsx ──
var { useState } = React;
var { useRouter } = window.__s_next_router;
var axios = window.axios;;

function Register() {
  const [form, setForm] = useState({ email: '', username: '', password: '', name: '' });
  const [error, setError] = useState('');
  const router = useRouter();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await axios.post('/api/auth/register', form);
      router.push('/login');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow-md w-80">
        <h2 className="text-2xl font-bold mb-4">Register</h2>
        {error && <div className="text-red-600 mb-2">{error}</div>}
        <input
          type="text"
          name="name"
          placeholder="Name"
          className="border p-2 mb-2 w-full"
          value={form.name}
          onChange={handleChange}
          required
        />
        <input
          type="text"
          name="username"
          placeholder="Username"
          className="border p-2 mb-2 w-full"
          value={form.username}
          onChange={handleChange}
          required
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          className="border p-2 mb-2 w-full"
          value={form.email}
          onChange={handleChange}
          required
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          className="border p-2 mb-4 w-full"
          value={form.password}
          onChange={handleChange}
          required
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded w-full">Register</button>
      </form>
    </div>
  );
}

var __d_frontend_pages_register = Register;


// ── frontend/pages/feed.tsx ──
var { useEffect, useState } = React;
var axios = window.axios;;
var { useSelector } = window.__s_react_redux;
;
var Link = (window.__s_next_link&&window.__s_next_link.default)||window.__s_next_link;

function Feed() {
  const [posts, setPosts] = useState<any[]>([]);
  const user = useSelector((state: RootState) => state.auth.user);
  const token = useSelector((state: RootState) => state.auth.token);

  useEffect(() => {
    if (!token) return;
    axios.get('/api/posts/feed', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setPosts(res.data))
      .catch(() => setPosts([]));
  }, [token]);

  if (!user) return <div className="p-4">Please <Link href="/login" className="text-blue-600 underline">login</Link> to view your feed.</div>;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Your Feed</h2>
      {posts.length === 0 && <div>No posts yet.</div>}
      {posts.map(post => (
        <div key={post.id} className="bg-white rounded shadow p-4 mb-4">
          <div className="font-bold">{post.author.name}</div>
          <div className="text-gray-700 mb-2">{post.content}</div>
          {post.mediaUrl && (
            post.mediaType === 'image' ? (
              <img src={post.mediaUrl} alt="media" className="max-w-full mb-2" />
            ) : (
              <video src={post.mediaUrl} controls className="max-w-full mb-2" />
            )
          )}
          <div className="text-xs text-gray-500">{new Date(post.createdAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

var __d_frontend_pages_feed = Feed;


// ── frontend/pages/profile.tsx ──
var { useEffect, useState } = React;
var axios = window.axios;;
var { useSelector } = window.__s_react_redux;
;

function Profile() {
  const [profile, setProfile] = useState<any>(null);
  const token = useSelector((state: RootState) => state.auth.token);

  useEffect(() => {
    if (!token) return;
    axios.get('/api/users/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setProfile(res.data))
      .catch(() => setProfile(null));
  }, [token]);

  if (!profile) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-lg mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Profile</h2>
      <div className="bg-white rounded shadow p-4">
        {profile.avatarUrl && <img src={profile.avatarUrl} alt="avatar" className="w-24 h-24 rounded-full mb-2" />}
        <div className="font-bold">{profile.name}</div>
        <div className="text-gray-700">@{profile.username}</div>
        <div className="text-gray-500">{profile.email}</div>
        <div className="mt-2">{profile.bio}</div>
      </div>
    </div>
  );
}

var __d_frontend_pages_profile = Profile;


// ── frontend/store/authSlice.ts ──
var { createSlice, createAsyncThunk } = window.__s__reduxjs_toolkit;
var axios = window.axios;;

interface AuthState {
  user: any | null;
  token: string | null;
}

const initialState: AuthState = {
  user: null,
  token: null
};

const login = createAsyncThunk(
  'auth/login',
  async ({ email, password }: { email: string; password: string }, thunkAPI) => {
    try {
      const res = await axios.post('/api/auth/login', { email, password });
      if (typeof window !== 'undefined') {
        localStorage.setItem('token', res.data.token);
      }
      return { user: res.data.user, token: res.data.token };
    } catch (err: any) {
      return thunkAPI.rejectWithValue(err.response?.data?.error || 'Login failed');
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.user = null;
      state.token = null;
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
      }
    },
    setAuth(state, action) {
      state.user = action.payload.user;
      state.token = action.payload.token;
    }
  },
  extraReducers: builder => {
    builder.addCase(login.fulfilled, (state, action) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
    });
    builder.addCase(login.rejected, (state, action) => {
      state.user = null;
      state.token = null;
    });
  }
});

const { logout, setAuth } = authSlice.actions;
var __d_frontend_store_authSlice = (authSlice.reducer);


// ── frontend/pages/index.tsx ──
var { useSelector } = window.__s_react_redux;
var Link = (window.__s_next_link&&window.__s_next_link.default)||window.__s_next_link;
;

function Home() {
  const user = useSelector((state: RootState) => state.auth.user);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <h1 className="text-4xl font-bold mb-4">ConnectSphere</h1>
      {user ? (
        <>
          <p className="mb-2">Welcome, {user.name}!</p>
          <Link href="/feed" className="text-blue-600 underline">Go to Feed</Link>
        </>
      ) : (
        <>
          <Link href="/login" className="text-blue-600 underline">Login</Link> |{' '}
          <Link href="/register" className="text-blue-600 underline">Register</Link>
        </>
      )}
    </div>
  );
}

var __d_frontend_pages = Home;


// ── frontend/store/index.ts ──
var { configureStore } = window.__s__reduxjs_toolkit;
var authReducer = __d_frontend_store_authSlice;

const store = configureStore({
  reducer: {
    auth: authReducer
  }
});

type RootState = ReturnType<typeof store.getState>;
type AppDispatch = typeof store.dispatch;


// ── frontend/next-env.d.ts ──
/// <reference types="next" />
/// <reference types="next/types/global" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/basic-features/typescript for more information.


// ── frontend/jest.setup.js ──
;

(function(){var rootEl=document.getElementById('root');if(!rootEl)return;try{if(typeof App!=='undefined'){ReactDOM.createRoot(rootEl).render(React.createElement(App, { Component: Home, pageProps: {} }));}else{rootEl.innerHTML='<p style="padding:2rem;color:#555">Component <code>App</code> not found.</p>';}}catch(e){rootEl.innerHTML='<pre style="padding:2rem;color:red;white-space:pre-wrap">'+(e&&e.message||String(e))+'</pre>';}})();
