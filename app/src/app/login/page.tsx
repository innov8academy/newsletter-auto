'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Lock, Sparkles } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [checkingAuth, setCheckingAuth] = useState(true);

    // Check if already authenticated
    useEffect(() => {
        fetch('/api/status')
            .then(res => res.json())
            .then(data => {
                // If we can access status without being redirected, we might be logged in
                // Or no password is set
                if (!data.passwordRequired) {
                    router.push('/');
                } else {
                    setCheckingAuth(false);
                }
            })
            .catch(() => {
                setCheckingAuth(false);
            });
    }, [router]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            const data = await response.json();

            if (data.success) {
                router.push('/');
                router.refresh();
            } else {
                setError(data.error || 'Authentication failed');
            }
        } catch (err) {
            setError('Connection failed. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    if (checkingAuth) {
        return (
            <div className="min-h-screen bg-[#0B0B0F] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0B0B0F] text-white flex flex-col items-center justify-center p-4 relative noise-overlay">
            {/* Atmospheric gradient */}
            <div className="absolute inset-0 bg-gradient-to-b from-amber-900/5 via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-gradient-radial from-coral-500/5 to-transparent pointer-events-none blur-3xl" />

            {/* Content */}
            <div className="relative z-10 w-full max-w-sm">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl overflow-hidden shadow-glow-amber mb-4">
                        <Image src="/logo.jpg" alt="Innov8 AI" width={64} height={64} className="object-cover" />
                    </div>
                    <h1 className="font-display text-3xl font-semibold tracking-tight">
                        Innov8 AI
                    </h1>
                    <p className="text-white/40 text-sm mt-2">
                        Enter password to access the newsletter platform
                    </p>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                        <Input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                            className="w-full pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 h-12"
                            autoFocus
                        />
                    </div>

                    {error && (
                        <div className="text-coral-400 text-sm text-center bg-coral-500/10 border border-coral-500/20 rounded-lg p-3">
                            {error}
                        </div>
                    )}

                    <Button
                        type="submit"
                        disabled={loading || !password.trim()}
                        className="w-full h-12 bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F] font-semibold border-0 shadow-glow-amber"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Authenticating...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Continue
                            </>
                        )}
                    </Button>
                </form>

                {/* Footer */}
                <p className="text-center text-white/20 text-xs mt-8">
                    Protected newsletter automation platform
                </p>
            </div>
        </div>
    );
}
