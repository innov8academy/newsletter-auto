'use client';

import { useState } from 'react';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';

export default function BeehiveImporter() {
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setStatus('idle');
        setMessage('');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload-history', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Upload failed');

            setStatus('success');
            setMessage('Newsletter learned! The next draft will mimic this style.');
        } catch (err: any) {
            setStatus('error');
            setMessage(err.message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="p-4 border border-dashed border-gray-700 rounded-lg bg-gray-900/50">
            <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
                <Upload size={16} />
                Teach the AI (Upload Past Newsletter)
            </h3>
            <p className="text-xs text-gray-400 mb-4">
                Upload a `.html` file from Beehiiv. The AI will read it to learn your exact voice and formatting.
            </p>

            <div className="flex items-center gap-4">
                <label className={`
                    px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors
                    ${uploading ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white'}
                `}>
                    {uploading ? 'Analyzing...' : 'Select HTML File'}
                    <input
                        type="file"
                        accept=".html,.htm"
                        className="hidden"
                        onChange={handleFileUpload}
                        disabled={uploading}
                    />
                </label>

                {status === 'success' && (
                    <div className="flex items-center gap-2 text-green-400 text-sm animate-in fade-in">
                        <CheckCircle size={16} />
                        <span>{message}</span>
                    </div>
                )}

                {status === 'error' && (
                    <div className="flex items-center gap-2 text-red-400 text-sm animate-in fade-in">
                        <AlertCircle size={16} />
                        <span>{message}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
