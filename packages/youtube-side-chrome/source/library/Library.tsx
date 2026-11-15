import {
    type ChangeEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import {
    createBackup,
    exportLibraryMarkdown,
    exportStudyMarkdown,
    findNoteTimestamps,
    formatTimestamp,
    parseBackup,
    type StudyEntry,
    timestampUrl,
    watchUrl,
} from '~data/study';
import { deleteVideoStudy, importStudies, loadLibrary, subscribeLibrary } from '~data/studyStore';

import {
    StyledBookmarks,
    StyledButton,
    StyledCard,
    StyledCardActions,
    StyledEmpty,
    StyledHeader,
    StyledLibrary,
    StyledList,
    StyledMeta,
    StyledNote,
    StyledSearch,
    StyledStatus,
    StyledToolbar,
} from './styled';

const RELOAD_DELAY = 150;
const CONFIRM_DELAY = 4_000;
const DOWNLOAD_REVOKE_DELAY = 10_000;

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Everything a search can match for one video, folded once. */
const searchText = ({ videoId, study }: StudyEntry): string =>
    fold(
        [
            videoId,
            study.title,
            study.channel,
            study.note,
            ...study.bookmarks.flatMap((bookmark) => [bookmark.label, bookmark.note]),
        ].join('\n'),
    );

export const filterEntries = (entries: StudyEntry[], query: string): StudyEntry[] => {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
        return entries;
    }
    return entries.filter((entry) => {
        const text = searchText(entry);
        return terms.every((term) => text.includes(term));
    });
};

const download = (filename: string, contents: string, type: string): void => {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, DOWNLOAD_REVOKE_DELAY);
};

const today = () => new Date().toISOString().slice(0, 10);

const formatDate = (time: number): string =>
    new Date(time).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });

/** A note's text with its timestamps as links to that moment. */
const NoteText = ({ note, videoId }: { note: string; videoId: string }) => {
    const parts: ReactNode[] = [];
    let offset = 0;
    for (const { index, text, timeMs } of findNoteTimestamps(note)) {
        parts.push(note.slice(offset, index));
        parts.push(
            <a
                key={index}
                href={timestampUrl(watchUrl(videoId), Math.floor(timeMs / 1000))}
                target="_blank"
                rel="noreferrer"
            >
                {text}
            </a>,
        );
        offset = index + text.length;
    }
    parts.push(note.slice(offset));
    return <>{parts}</>;
};

interface EntryCardProperties {
    entry: StudyEntry;
    expanded: boolean;
    confirming: boolean;
    atToggle: () => void;
    atCopy: () => void;
    atDelete: () => void;
}

const EntryCard = ({
    entry,
    expanded,
    confirming,
    atToggle,
    atCopy,
    atDelete,
}: EntryCardProperties) => {
    const { videoId, study } = entry;
    const url = watchUrl(videoId);
    const count = study.bookmarks.length;

    return (
        <StyledCard>
            <h2>
                <a href={url} target="_blank" rel="noreferrer">
                    {study.title || videoId}
                </a>
            </h2>
            <StyledMeta>
                {[
                    study.channel,
                    `${count} ${count === 1 ? 'bookmark' : 'bookmarks'}`,
                    `updated ${formatDate(study.updatedAt)}`,
                ]
                    .filter(Boolean)
                    .join(' · ')}
            </StyledMeta>

            {study.note.trim() && (
                <StyledNote $collapsed={!expanded}>
                    <NoteText note={study.note} videoId={videoId} />
                </StyledNote>
            )}

            {expanded && count > 0 && (
                <StyledBookmarks aria-label="Bookmarks">
                    {study.bookmarks.map((bookmark) => (
                        <li key={bookmark.createdAt}>
                            <a
                                href={timestampUrl(url, Math.floor(bookmark.timeMs / 1000))}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {formatTimestamp(bookmark.timeMs)}
                            </a>
                            <span>
                                {[bookmark.label, bookmark.note].filter(Boolean).join(': ')}
                            </span>
                        </li>
                    ))}
                </StyledBookmarks>
            )}

            <StyledCardActions>
                <StyledButton type="button" aria-expanded={expanded} onClick={atToggle}>
                    {expanded ? 'Show less' : 'Show all'}
                </StyledButton>
                <StyledButton type="button" onClick={atCopy}>
                    Copy as Markdown
                </StyledButton>
                <StyledButton type="button" $danger={confirming} onClick={atDelete}>
                    {confirming ? 'Delete these notes?' : 'Delete'}
                </StyledButton>
            </StyledCardActions>
        </StyledCard>
    );
};

const Library = () => {
    const [entries, setEntries] = useState<StudyEntry[] | null>(null);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [confirming, setConfirming] = useState<string | null>(null);
    const [status, setStatus] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);
    const confirmTimer = useRef<number | undefined>(undefined);

    const reload = useCallback(async () => {
        try {
            setEntries(await loadLibrary());
        } catch {
            setEntries([]);
            setStatus("Couldn't read your notes from browser storage.");
        }
    }, []);

    useEffect(() => {
        let timer: number | undefined;
        void reload();
        // notes taken in any tab show up here as they are saved
        const unsubscribe = subscribeLibrary(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                void reload();
            }, RELOAD_DELAY);
        });
        return () => {
            unsubscribe();
            window.clearTimeout(timer);
            window.clearTimeout(confirmTimer.current);
        };
    }, [reload]);

    const visible = useMemo(() => filterEntries(entries ?? [], query), [entries, query]);
    const bookmarkCount = useMemo(
        () => (entries ?? []).reduce((total, entry) => total + entry.study.bookmarks.length, 0),
        [entries],
    );

    const toggle = (videoId: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(videoId)) {
                next.add(videoId);
            }
            return next;
        });
    };

    const copy = async (entry: StudyEntry) => {
        const markdown = exportStudyMarkdown(
            entry.study.title || entry.videoId,
            watchUrl(entry.videoId),
            entry.study,
        );
        try {
            await navigator.clipboard.writeText(markdown);
            setStatus(`Copied the notes for ${entry.study.title || entry.videoId}.`);
        } catch {
            setStatus("Couldn't copy to the clipboard.");
        }
    };

    // deleting takes a second click, so one stray click cannot lose a video's notes
    const remove = async (videoId: string) => {
        window.clearTimeout(confirmTimer.current);
        if (confirming !== videoId) {
            setConfirming(videoId);
            confirmTimer.current = window.setTimeout(() => {
                setConfirming(null);
            }, CONFIRM_DELAY);
            return;
        }

        setConfirming(null);
        try {
            await deleteVideoStudy(videoId);
            setStatus('Deleted.');
            await reload();
        } catch {
            setStatus("Couldn't delete these notes.");
        }
    };

    const exportMarkdown = () => {
        download(
            `youtube-side-notes-${today()}.md`,
            exportLibraryMarkdown(visible),
            'text/markdown;charset=utf-8',
        );
        setStatus(
            `Exported ${visible.length} ${visible.length === 1 ? 'video' : 'videos'} as Markdown.`,
        );
    };

    const backup = () => {
        download(
            `youtube-side-backup-${today()}.json`,
            `${JSON.stringify(createBackup(entries ?? []), null, 2)}\n`,
            'application/json',
        );
        setStatus('Saved a backup of every video.');
    };

    const restore = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }

        let parsed: StudyEntry[] | null = null;
        try {
            parsed = parseBackup(JSON.parse(await file.text()));
        } catch {
            parsed = null;
        }
        if (!parsed) {
            setStatus('That file is not a YouTube Side backup.');
            return;
        }

        try {
            const count = await importStudies(parsed);
            setStatus(
                `Restored ${count} ${count === 1 ? 'video' : 'videos'}, merged with the notes already here.`,
            );
            await reload();
        } catch {
            setStatus("Couldn't restore the backup. Browser storage may be unavailable.");
        }
    };

    const total = entries?.length ?? 0;

    return (
        <StyledLibrary>
            <StyledHeader>
                <h1>YouTube Side notes</h1>
                <StyledMeta>
                    {entries === null
                        ? 'Loading…'
                        : `${total} ${total === 1 ? 'video' : 'videos'} · ${bookmarkCount} ${bookmarkCount === 1 ? 'bookmark' : 'bookmarks'}, kept in this browser`}
                </StyledMeta>

                <StyledToolbar>
                    <StyledSearch
                        type="search"
                        placeholder="Search titles, channels, notes, and bookmarks"
                        aria-label="Search notes"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                        }}
                    />
                    <StyledButton
                        type="button"
                        onClick={exportMarkdown}
                        disabled={visible.length === 0}
                    >
                        {query.trim() ? 'Export matches' : 'Export Markdown'}
                    </StyledButton>
                    <StyledButton type="button" onClick={backup} disabled={total === 0}>
                        Back up
                    </StyledButton>
                    <StyledButton
                        type="button"
                        onClick={() => {
                            fileInput.current?.click();
                        }}
                    >
                        Restore
                    </StyledButton>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="application/json,.json"
                        aria-label="Restore a backup file"
                        hidden
                        onChange={(event) => {
                            void restore(event);
                        }}
                    />
                </StyledToolbar>

                <StyledStatus role="status" aria-live="polite">
                    {status}
                </StyledStatus>
            </StyledHeader>

            {entries !== null && total === 0 && (
                <StyledEmpty>
                    No notes yet. On a YouTube video, press Alt/Option + M to bookmark the moment,
                    or open the Side panel's Notes view to write.
                </StyledEmpty>
            )}

            {total > 0 && visible.length === 0 && (
                <StyledEmpty>No notes match “{query.trim()}”.</StyledEmpty>
            )}

            {visible.length > 0 && (
                <StyledList>
                    {visible.map((entry) => (
                        <EntryCard
                            key={entry.videoId}
                            entry={entry}
                            expanded={expanded.has(entry.videoId)}
                            confirming={confirming === entry.videoId}
                            atToggle={() => {
                                toggle(entry.videoId);
                            }}
                            atCopy={() => {
                                void copy(entry);
                            }}
                            atDelete={() => {
                                void remove(entry.videoId);
                            }}
                        />
                    ))}
                </StyledList>
            )}
        </StyledLibrary>
    );
};

export default Library;
