import { dewiki } from '@plurid/plurid-themes';
import {
    Dropdown,
    InputLine,
    InputSwitch,
    LinkButton,
    Slider,
} from '@plurid/plurid-ui-components-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getActiveTab } from '~common/utilities';
import { isSideResponse, type SideRequest, type SideStatus } from '~data/messages';
import {
    AUTO_ACTIVATE_MODES,
    type AutoActivate,
    BLUR_MAX,
    BLUR_MIN,
    type ChannelRule,
    DEFAULT_OPTIONS,
    HEIGHT_MAX,
    HEIGHT_MIN,
    INVERT_TEXT_MODES,
    type InvertTextMode,
    LAYOUT_ANCHORS,
    type LayoutAnchor,
    loadOptions,
    normalizeOptions,
    OPACITY_MAX,
    OPACITY_MIN,
    type Options,
    type OptionsUpdate,
    resetOptions,
    STUDY_AUTO_OPEN_MODES,
    type StudyAutoOpen,
    subscribeOptions,
    updateOptions,
    WIDTH_MAX,
    WIDTH_MIN,
} from '~data/options';

import {
    inputStyle,
    StyledHint,
    StyledNotice,
    StyledOptionRow,
    StyledPopup,
    StyledSection,
    StyledSliders,
} from './styled';

const SAVE_DELAY = 200;

interface DimensionFieldProperties {
    name: string;
    value: number;
    min: number;
    max: number;
    atChange: (value: number) => void;
}

/**
 * The input is controlled, so clamping every keystroke would turn the "8" on
 * the way to "800" into the minimum. A draft keeps the text as typed; values
 * already in bounds apply live, anything else is clamped on blur or Enter.
 */
const DimensionField = ({ name, value, min, max, atChange }: DimensionFieldProperties) => {
    const [draft, setDraft] = useState<string | null>(null);

    const commit = () => {
        if (draft === null) {
            return;
        }

        const parsed = Number.parseInt(draft, 10);
        if (Number.isFinite(parsed)) {
            atChange(Math.min(max, Math.max(min, parsed)));
        }
        setDraft(null);
    };

    return (
        <InputLine
            name={name}
            text={draft ?? String(value)}
            atChange={(event) => {
                const text = event.target.value;
                setDraft(text);

                const parsed = Number.parseInt(text, 10);
                if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
                    atChange(parsed);
                }
            }}
            atKeyDown={(event) => {
                if (event.key === 'Enter') {
                    commit();
                }
            }}
            theme={dewiki}
            textline={{
                type: 'number',
                atBlur: commit,
            }}
            style={inputStyle}
        />
    );
};

export const LIBRARY_PAGE = 'library.html';

const openLibrary = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(LIBRARY_PAGE) });
};

const sendToActiveTab = async (request: SideRequest): Promise<SideStatus> => {
    const tab = await getActiveTab();
    const response: unknown = await chrome.tabs.sendMessage(tab.id as number, request);
    if (!isSideResponse(response)) {
        throw new Error('The active tab did not return a YouTube Side status');
    }
    return response.status;
};

const Popup = () => {
    const [loading, setLoading] = useState(true);
    const [options, setOptions] = useState<Options>({ ...DEFAULT_OPTIONS });
    const [sideStatus, setSideStatus] = useState<SideStatus | undefined>(undefined);
    const pendingUpdate = useRef<OptionsUpdate>({});
    const saveTimer = useRef<number | undefined>(undefined);

    const commitUpdate = useCallback(async (update: OptionsUpdate) => {
        try {
            const saved = await updateOptions(update);
            setOptions(saved);
        } catch {
            return;
        }
    }, []);

    const changeOption = useCallback(
        (update: OptionsUpdate, delayed = false) => {
            setOptions((current) =>
                normalizeOptions({
                    ...current,
                    ...update,
                }),
            );

            if (!delayed) {
                void commitUpdate(update);
                return;
            }

            pendingUpdate.current = {
                ...pendingUpdate.current,
                ...update,
            };

            if (typeof saveTimer.current === 'number') {
                window.clearTimeout(saveTimer.current);
            }

            saveTimer.current = window.setTimeout(() => {
                const pending = pendingUpdate.current;
                pendingUpdate.current = {};
                saveTimer.current = undefined;
                void commitUpdate(pending);
            }, SAVE_DELAY);
        },
        [commitUpdate],
    );

    const reset = async () => {
        pendingUpdate.current = {};
        if (typeof saveTimer.current === 'number') {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
        }

        try {
            const resetValue = await resetOptions();
            setOptions(resetValue);
        } catch {
            return;
        }
    };

    const toggleSide = async () => {
        try {
            const status = await sendToActiveTab({
                type: 'SET_ACTIVE',
                active: !sideStatus?.active,
            });
            setSideStatus(status);
        } catch {
            setSideStatus(undefined);
        }
    };

    const applyChannelRule = async (channelKey: string, rule: ChannelRule | null) => {
        const channelRules = { ...options.channelRules };
        delete channelRules[channelKey];
        if (rule !== null) {
            channelRules[channelKey] = rule;
        }
        setOptions((current) => normalizeOptions({ ...current, channelRules }));

        // the page applies and stores the rule so it can re-evaluate the open video;
        // the popup only stores it itself when no YouTube tab answers
        try {
            setSideStatus(
                await sendToActiveTab({
                    type: 'APPLY_CHANNEL_RULE',
                    channelKey,
                    rule,
                }),
            );
        } catch {
            await commitUpdate({ channelRules });
        }
    };

    useEffect(() => {
        let mounted = true;

        const readStatus = async () => {
            try {
                const status = await sendToActiveTab({ type: 'GET_STATE' });
                if (mounted) {
                    setSideStatus(status);
                }
            } catch {
                return;
            }
        };

        void readStatus();

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        let mounted = true;

        const hydrate = async () => {
            const loadedOptions = await loadOptions().catch(() => ({ ...DEFAULT_OPTIONS }));

            if (!mounted) {
                return;
            }

            setOptions(loadedOptions);
            setLoading(false);
        };

        const unsubscribe = subscribeOptions((updatedOptions) => {
            if (mounted) {
                setOptions(updatedOptions);
            }
        });

        void hydrate();

        return () => {
            mounted = false;
            unsubscribe();

            if (typeof saveTimer.current === 'number') {
                window.clearTimeout(saveTimer.current);
            }
        };
    }, []);

    if (loading) {
        return <StyledPopup theme={dewiki} />;
    }

    const background = options.background === 'opaque';
    const channelKey = sideStatus?.context?.channelKey;

    return (
        <StyledPopup theme={dewiki}>
            <h1>YouTube Side</h1>

            <div>press alt/option (⌥) + S on a YouTube page to activate side positioning</div>

            {sideStatus?.suspendReason && (
                <StyledNotice>Suspended in {sideStatus.suspendReason}</StyledNotice>
            )}

            {sideStatus?.layout === 'panels' && (
                <StyledNotice>
                    YouTube's new layout keeps the description and comments in its own panel
                </StyledNotice>
            )}

            {sideStatus?.dodged && (
                <StyledNotice>Moved to the other side while YouTube's panel is open</StyledNotice>
            )}

            {sideStatus?.available && (
                <InputSwitch
                    name="side position [⌥ + S]"
                    checked={sideStatus.active}
                    atChange={() => {
                        void toggleSide();
                    }}
                    theme={dewiki}
                    compact={true}
                    style={inputStyle}
                />
            )}

            <InputSwitch
                name="background [⌥ + B]"
                checked={background}
                atChange={() => {
                    changeOption({
                        background: background ? 'transparent' : 'opaque',
                    });
                }}
                theme={dewiki}
                style={inputStyle}
            />

            {background && (
                <StyledSliders>
                    <Slider
                        name="blur"
                        value={options.blur}
                        atChange={(blur) => {
                            changeOption({ blur }, true);
                        }}
                        min={BLUR_MIN}
                        max={BLUR_MAX}
                        step={1}
                        width={238}
                        namedValueAbove={true}
                        valueSign="px"
                        theme={dewiki}
                        level={2}
                    />

                    <Slider
                        name="opacity"
                        value={options.opacity}
                        atChange={(opacity) => {
                            changeOption({ opacity }, true);
                        }}
                        min={OPACITY_MIN}
                        max={OPACITY_MAX}
                        step={1}
                        width={238}
                        namedValueAbove={true}
                        valueSign="%"
                        theme={dewiki}
                        level={2}
                    />
                </StyledSliders>
            )}

            <StyledOptionRow>
                <div>invert text</div>
                <Dropdown
                    selectables={[...INVERT_TEXT_MODES]}
                    selected={options.invertText}
                    atSelect={(selection) => {
                        changeOption({ invertText: selection as InvertTextMode });
                    }}
                    selectAtHover={false}
                    theme={dewiki}
                    level={2}
                    width={90}
                />
            </StyledOptionRow>

            <InputSwitch
                name="left side [⌥ + L]"
                checked={options.left}
                atChange={() => {
                    changeOption({ left: !options.left });
                }}
                theme={dewiki}
                style={inputStyle}
            />

            <DimensionField
                name="width"
                value={options.width}
                min={WIDTH_MIN}
                max={WIDTH_MAX}
                atChange={(width) => {
                    changeOption({ width, customSize: true }, true);
                }}
            />

            <DimensionField
                name="height"
                value={options.height}
                min={HEIGHT_MIN}
                max={HEIGHT_MAX}
                atChange={(height) => {
                    changeOption({ height, customSize: true }, true);
                }}
            />

            <InputSwitch
                name="recommendations [⌥ + R]"
                checked={options.recommendations}
                atChange={() => {
                    changeOption({ recommendations: !options.recommendations });
                }}
                theme={dewiki}
                style={inputStyle}
            />

            <StyledSection>
                <h2>In the Panel</h2>

                <InputSwitch
                    name="description"
                    checked={options.showDescription}
                    atChange={() => {
                        changeOption({ showDescription: !options.showDescription });
                    }}
                    theme={dewiki}
                    style={inputStyle}
                />

                <InputSwitch
                    name="comments"
                    checked={options.showComments}
                    atChange={() => {
                        changeOption({ showComments: !options.showComments });
                    }}
                    theme={dewiki}
                    style={inputStyle}
                />

                <InputSwitch
                    name="live chat"
                    checked={options.showChat}
                    atChange={() => {
                        changeOption({ showChat: !options.showChat });
                    }}
                    theme={dewiki}
                    style={inputStyle}
                />
            </StyledSection>

            {/* Adaptive Layout Section */}
            <StyledSection>
                <h2>Adaptive Layout</h2>

                <StyledOptionRow>
                    <div>anchor</div>
                    <Dropdown
                        selectables={[...LAYOUT_ANCHORS]}
                        selected={options.layoutAnchor}
                        atSelect={(selection) => {
                            changeOption({ layoutAnchor: selection as LayoutAnchor });
                        }}
                        selectAtHover={false}
                        theme={dewiki}
                        level={2}
                        width={110}
                    />
                </StyledOptionRow>

                <StyledOptionRow>
                    <div>auto-activate</div>
                    <Dropdown
                        selectables={[...AUTO_ACTIVATE_MODES]}
                        selected={options.autoActivate}
                        atSelect={(selection) => {
                            changeOption({ autoActivate: selection as AutoActivate });
                        }}
                        selectAtHover={false}
                        theme={dewiki}
                        level={2}
                        width={110}
                    />
                </StyledOptionRow>

                {channelKey && (
                    <StyledOptionRow>
                        <div>channel rule</div>
                        <Dropdown
                            selectables={['default', 'always', 'never']}
                            selected={options.channelRules[channelKey] ?? 'default'}
                            atSelect={(selection) => {
                                const rule =
                                    selection === 'default' ? null : (selection as ChannelRule);
                                void applyChannelRule(channelKey, rule);
                            }}
                            selectAtHover={false}
                            theme={dewiki}
                            level={2}
                            width={110}
                        />
                    </StyledOptionRow>
                )}
            </StyledSection>

            {/* Study Mode Section */}
            <StyledSection>
                <h2>Study Mode</h2>

                <InputSwitch
                    name="study mode [⌥ + T]"
                    checked={options.studyEnabled}
                    atChange={() => {
                        changeOption({ studyEnabled: !options.studyEnabled });
                    }}
                    theme={dewiki}
                    style={inputStyle}
                />

                {options.studyEnabled && (
                    <>
                        <InputSwitch
                            name="follow transcript"
                            checked={options.studyFollow}
                            atChange={() => {
                                changeOption({ studyFollow: !options.studyFollow });
                            }}
                            theme={dewiki}
                            style={inputStyle}
                        />

                        <InputSwitch
                            name="bookmarks on the progress bar"
                            checked={options.bookmarkMarkers}
                            atChange={() => {
                                changeOption({ bookmarkMarkers: !options.bookmarkMarkers });
                            }}
                            theme={dewiki}
                            style={inputStyle}
                        />

                        <StyledOptionRow>
                            <div>auto-open view</div>
                            <Dropdown
                                selectables={[...STUDY_AUTO_OPEN_MODES]}
                                selected={options.studyAutoOpen}
                                atSelect={(selection) => {
                                    changeOption({
                                        studyAutoOpen: selection as StudyAutoOpen,
                                    });
                                }}
                                selectAtHover={false}
                                theme={dewiki}
                                level={2}
                                width={110}
                            />
                        </StyledOptionRow>
                        <StyledHint>
                            ⌥ + M bookmarks the moment, or inserts the time in a note
                        </StyledHint>
                    </>
                )}

                <LinkButton
                    text="notes library"
                    atClick={openLibrary}
                    theme={dewiki}
                    inline={true}
                />
            </StyledSection>

            <div>
                <LinkButton
                    text="reset"
                    atClick={() => {
                        void reset();
                    }}
                    theme={dewiki}
                    style={{
                        marginTop: '1.5rem',
                    }}
                    inline={true}
                />
            </div>
        </StyledPopup>
    );
};

export default Popup;
