import { useState, useEffect } from 'react';
import { Folder, File, ChevronUp, Check, X, Loader2, HardDrive, AlertCircle } from 'lucide-react'; // HardDrive icon is good for root/drives
import { api } from '../api';

interface FileEntry {
    name: string;
    isDirectory: boolean;
}

interface FileBrowserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    initialPath?: string;
    mode?: 'file' | 'directory'; // directory mode allows selecting folders
    title?: string;
}

export const FileBrowserModal = ({ isOpen, onClose, onSelect, initialPath, mode = 'directory', title }: FileBrowserModalProps) => {
    const [currentPath, setCurrentPath] = useState('');
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

    // Initialize path
    useEffect(() => {
        if (isOpen) {
            // If initialized with a path, try to use it. Defaults to empty (which backend treats as CWD)
            // If initialPath is empty string, we might want to start at backend CWD.
            // But let's start with initialPath if provided.
            loadDirectory(initialPath || '');
        }
    }, [isOpen, initialPath]);

    const loadDirectory = async (path: string, isRetry = false) => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listFiles(path);
            setCurrentPath(data.path);
            setEntries(data.entries);
            setSelectedEntry(null); // Clear selection on navigate
        } catch (err: any) {
            console.error("Failed to load directory:", path, err);
            // If this was a failed load, try to fallback to CWD (empty string)
            // Only retry once to avoid infinite loops, and only if we aren't already at root/empty
            if (!isRetry && path !== '') {
                console.log("Attempting fallback to default directory...");
                // process.nextTick or just await? await is fine.
                // We recursively call with isRetry=true
                await loadDirectory('', true);
            } else {
                setError(err.message || 'Failed to load directory');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleNavigate = (entryName: string) => {
        // Construct new path. 
        // Need to handle path separators. Backend sends normalized paths?
        // Let's assume standard path joining.
        // If currentPath ends with separator, don't add another.
        const separator = currentPath.includes('\\') ? '\\' : '/';
        const newPath = currentPath.endsWith(separator)
            ? `${currentPath}${entryName}`
            : `${currentPath}${separator}${entryName}`;

        loadDirectory(newPath);
    };

    const handleUp = () => {
        // Simple string manipulation for now, or request parent from backend?
        // Backend `path.resolve(currentPath, '..')` behavior logic
        loadDirectory(`${currentPath}/..`);
    };

    const handleSelect = () => {
        let finalPath = currentPath;
        if (selectedEntry) {
            // Use same separator logic
            const separator = currentPath.includes('\\') ? '\\' : '/';
            finalPath = currentPath.endsWith(separator)
                ? `${currentPath}${selectedEntry}`
                : `${currentPath}${separator}${selectedEntry}`;
        }

        // Validation based on mode
        // If mode is directory, and we selected a file? 
        // The UI should prevent selecting files if mode is directory, or verify.
        // For now, if we selected an entry, passing that path.
        // If no entry selected, passing currentPath (for directory mode).

        // In directory mode with a file entry selected — ignore (only directories are valid)
        if (mode === 'directory' && selectedEntry) {
            const entry = entries.find(e => e.name === selectedEntry);
            if (entry && !entry.isDirectory) {
                return;
            }
        }

        // In directory mode with no selection — select the current directory
        if (mode === 'directory' && !selectedEntry) {
            onSelect(currentPath);
            onClose();
            return;
        }

        // Reaching here: directory mode with a dir entry selected, or file mode with selection.
        // (In file mode the Select button is disabled when nothing is selected, so selectedEntry
        //  is always set when handleSelect is invoked in file mode.)
        onSelect(finalPath);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="glass-card w-full max-w-2xl flex flex-col max-h-[80dvh] overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-white/[0.06] flex justify-between items-center">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        {mode === 'directory' ? <Folder className="text-brand-400 w-5 h-5" /> : <File className="text-brand-400 w-5 h-5" />}
                        {title || (mode === 'directory' ? 'Select Directory' : 'Select File')}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-full transition-colors">
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                </div>

                {/* Path Bar */}
                <div className="p-3 border-b border-white/[0.06] flex gap-2 items-center">
                    <button
                        onClick={handleUp}
                        className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
                        title="Go Up"
                    >
                        <ChevronUp className="w-5 h-5" />
                    </button>
                    <div className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-slate-500" />
                        <input
                            type="text"
                            value={currentPath}
                            onChange={(e) => setCurrentPath(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
                            className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-slate-200"
                        />
                        {loading && <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />}
                    </div>
                    <button
                        onClick={() => loadDirectory(currentPath)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 text-sm font-bold border border-slate-700/50"
                    >
                        Go
                    </button>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="p-3 bg-red-500/10 text-red-400 text-sm flex items-center gap-2 border-b border-red-500/20">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
                    {entries.length === 0 && !loading && !error && (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Folder className="w-12 h-12 mb-2 opacity-20" />
                            <p>Empty directory</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-1">
                        {entries.map((entry) => {
                            const isSelected = selectedEntry === entry.name;
                            return (
                                <div
                                    key={entry.name}
                                    onClick={() => setSelectedEntry(entry.name)}
                                    onDoubleClick={() => entry.isDirectory && handleNavigate(entry.name)}
                                    className={`
                                        flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors select-none
                                        ${isSelected ? 'bg-brand-500/15 text-brand-300 border border-brand-500/20' : 'hover:bg-slate-800/50 text-slate-300 border border-transparent'}
                                    `}
                                >
                                    {entry.isDirectory ? (
                                        <Folder className={`w-5 h-5 ${isSelected ? 'text-brand-500' : 'text-amber-400'}`} />
                                    ) : (
                                        <File className={`w-5 h-5 ${isSelected ? 'text-brand-500' : 'text-slate-400'}`} />
                                    )}
                                    <span className={`text-sm ${entry.isDirectory ? 'font-semibold' : ''} truncate`}>
                                        {entry.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/[0.06] flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-400 hover:text-slate-200 font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSelect}
                        disabled={mode === 'file' && !selectedEntry} // For directory, can select current path
                        className="px-6 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-bold shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center gap-2"
                    >
                        <Check className="w-4 h-4" />
                        Select {mode === 'directory' && !selectedEntry ? 'Current Folder' : 'Selection'}
                    </button>
                </div>
            </div>
        </div>
    );
};
