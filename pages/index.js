import { useState } from 'react';

export default function Home() {
  const [onionLink, setOnionLink] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleBypass = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/bypass?onion=${encodeURIComponent(onionLink)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError('Server ya network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'Arial' }}>
      <h1>Onion Payment Bypass</h1>
      <form onSubmit={handleBypass}>
        <input
          type="text"
          placeholder=".onion link daalo (without http://)"
          value={onionLink}
          onChange={(e) => setOnionLink(e.target.value)}
          style={{ width: '80%', padding: 8 }}
          required
        />
        <button type="submit" disabled={loading} style={{ padding: 8, marginLeft: 10 }}>
          {loading ? 'Bypass ho raha...' : 'Bypass Karo'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 20 }}>
          <h3>Bypassed Media:</h3>
          <p><strong>Type:</strong> {result.type}</p>
          {result.type === 'video/mp4' || result.type === 'video/webm' ? (
            <video controls width="600" src={result.url} />
          ) : result.type === 'application/x-mpegURL' ? (
            <p>HLS stream URL: {result.url} (VLC ya Hls.js se kholo)</p>
          ) : (
            <a href={result.url} target="_blank" rel="noreferrer">Direct Link</a>
          )}
          <p><strong>URL:</strong> {result.url}</p>
        </div>
      )}
    </div>
  );
}
