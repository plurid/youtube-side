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
    DEFAULT_OPTIONS,
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
} from '~data/options';

import {
    inputStyle,
    StyledNotice,
    StyledOptionRow,
    StyledPopup,
    StyledSection,
    StyledSliders,
} from './styled';

const SAVE_DELAY = 200;

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

    const applyChannelRule = async (channelKey: string, rule: 'always' | 'never' | null) => {
        const nextRules = { ...options.channelRules };
        if (rule === null) {
            delete nextRules[channelKey];
        } else {
            nextRules[channelKey] = rule;
        }
        changeOption({ channelRules: nextRules });

        try {
            const status = await sendToActiveTab({
                type: 'APPLY_CHANNEL_RULE',
                channelKey,
                rule,
            });
            setSideStatus(status);
        } catch {
            // Keep local change
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

            <InputLine
                name="width"
                text={String(options.width)}
                atChange={(event) => {
                    const width = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(width)) {
                        changeOption({ width }, true);
                    }
                }}
                theme={dewiki}
                textline={{
                    type: 'number',
                }}
                style={inputStyle}
            />

            <InputLine
                name="height"
                text={String(options.height)}
                atChange={(event) => {
                    const height = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(height)) {
                        changeOption({ height }, true);
                    }
                }}
                theme={dewiki}
                textline={{
                    type: 'number',
                }}
                style={inputStyle}
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
                                    selection === 'default'
                                        ? null
                                        : (selection as 'always' | 'never');
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
                    </>
                )}
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
