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

        if (mode === 'directory' && selectedEntry) {
            // Check if selected entry is a directory
            const entry = entries.find(e => e.name === selectedEntry);
            if (entry && !entry.isDirectory) {
                // If selected a file in directory mode, maybe we want to enter it? No, it's a file.
                // Just ignore or show error?
                // Let's assume user wants to select the folder they are IN if nothing selected,
                // OR the folder they selected. 
                // If they single-clicked a folder, `selectedEntry` is that folder.
                if (entry.isDirectory) {
                    onSelect(finalPath);
                    onClose();
                }
                return;
            }
        }

        // If mode is directory and nothing selected, return current path
        if (mode === 'directory' && !selectedEntry) {
            onSelect(currentPath);
            onClose();
            return;
        }

        if (mode === 'file') {
            if (selectedEntry) {
                onSelect(finalPath);
                onClose();
            } else {
                // Nothing selected in file mode?
                return;
            }
        }

        onSelect(finalPath);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh] overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        {mode === 'directory' ? <Folder className="text-brand-500 w-5 h-5" /> : <File className="text-brand-500 w-5 h-5" />}
                        {title || (mode === 'directory' ? 'Select Directory' : 'Select File')}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Path Bar */}
                <div className="p-3 border-b border-slate-100 flex gap-2 items-center bg-white">
                    <button
                        onClick={handleUp}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                        title="Go Up"
                    >
                        <ChevronUp className="w-5 h-5" />
                    </button>
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={currentPath}
                            onChange={(e) => setCurrentPath(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
                            className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-slate-700"
                        />
                        {loading && <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />}
                    </div>
                    <button
                        onClick={() => loadDirectory(currentPath)}
                        className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 text-sm font-bold"
                    >
                        Go
                    </button>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="p-3 bg-red-50 text-red-600 text-sm flex items-center gap-2 border-b border-red-100">
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
                                        ${isSelected ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'hover:bg-slate-50 text-slate-700 border border-transparent'}
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
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
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
