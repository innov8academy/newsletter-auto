'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Upload, CheckCircle2, FileText, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Initialize Client (Client-side safe with anon key)
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function UploadPage() {
    const router = useRouter();
    const [isClient, setIsClient] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    // Hydration fix
    useState(() => setIsClient(true));

    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setStatus('idle');
        }
    }

    async function processAndSave() {
        if (!file) return;

        setUploading(true);
        setStatus('idle');

        try {
            const text = await file.text();

            // Basic validation
            if (!text.includes('<html') && !text.includes('<!DOCTYPE html>')) {
                throw new Error('This does not look like an HTML file.');
            }

            // Convert HTML to simple text for RAG (Naive strip tags for now, or just store raw)
            // For RAG, we ideally want the text content.
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const cleanText = doc.body.textContent || "";

            // Save to Supabase
            const { error } = await supabase
                .from('past_newsletters')
                .insert({
                    file_name: file.name,
                    content_html: text,
                    content_text: cleanText,
                    imported_at: new Date().toISOString()
                });

            if (error) throw error;

            setStatus('success');
            setFile(null);

        } catch (err) {
            console.error(err);
            setStatus('error');
            setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
        }
    }

    if (!isClient) return null;

    return (
        <div className="min-h-screen bg-[#0B0B0F] text-white flex flex-col items-center justify-center p-4 noise-overlay">
            <div className="w-full max-w-md space-y-8 animate-in-up">

                <div className="text-center">
                    <h1 className="font-display text-3xl font-bold mb-2 text-gradient-editorial">Final Polish & Train</h1>
                    <p className="text-white/40">Upload your final edited HTML to train the AI on your latest style.</p>
                </div>

                <Card className="bg-black/40 border-white/10 p-8 border-dashed border-2 flex flex-col items-center gap-6 transition-all hover:border-purple-500/50 hover:bg-black/60">
                    {status === 'success' ? (
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-teal-500/10 rounded-full flex items-center justify-center mx-auto">
                                <CheckCircle2 className="w-8 h-8 text-teal-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-white">Upload Complete!</h3>
                            <p className="text-white/50 text-sm">Your AI has learned from this newsletter.</p>
                            <Button onClick={() => setStatus('idle')} variant="outline" className="border-white/10 text-white hover:bg-white/5">
                                Upload Another
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="w-20 h-20 bg-purple-500/10 rounded-full flex items-center justify-center animate-pulse-slow">
                                <Upload className="w-10 h-10 text-purple-400" />
                            </div>

                            <div className="text-center w-full">
                                <label className="block w-full cursor-pointer">
                                    <input type="file" accept=".html,.htm" onChange={handleFileUpload} className="hidden" />
                                    <div className="bg-white/5 hover:bg-white/10 transition-colors border border-white/10 rounded-lg p-4 flex items-center justify-center gap-2">
                                        {file ? (
                                            <span className="text-purple-300 font-medium truncate max-w-[200px]">{file.name}</span>
                                        ) : (
                                            <span className="text-white/60">Choose HTML File</span>
                                        )}
                                    </div>
                                </label>
                            </div>

                            <Button
                                onClick={processAndSave}
                                disabled={!file || uploading}
                                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold h-11"
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <FileText className="w-4 h-4 mr-2" />
                                        Save & Train AI
                                    </>
                                )}
                            </Button>
                        </>
                    )}

                    {status === 'error' && (
                        <div className="flex items-center gap-2 text-coral-400 text-sm bg-coral-500/10 p-3 rounded w-full">
                            <AlertCircle className="w-4 h-4" />
                            {errorMsg}
                        </div>
                    )}
                </Card>

                <div className="text-center">
                    <Button variant="ghost" className="text-white/30 hover:text-white" onClick={() => router.push('/')}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Return Home
                    </Button>
                </div>

            </div>
        </div>
    );
}
