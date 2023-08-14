// #region imports
    // #region libraries
    import React, {
        useRef,
        useState,
        useEffect,
    } from 'react';


    import {
        dewiki,
    } from '@plurid/plurid-themes';

    import {
        InputSwitch,
        InputLine,
        LinkButton,
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries


    // #region external
    import {
        Options,
    } from '~data/interfaces';

    import {
        OPTIONS_KEY,
        defaultOptions,
    } from '~data/constants';
    // #endregion external


    // #region internal
    import {
        StyledPopup,
        inputStyle,
    } from './styled';
    // #endregion internal
// #region imports



// #region module
export interface PopupProperties {
}

const Popup: React.FC<PopupProperties> = (
    _properties,
) => {
    // #region references
    const mounted = useRef(false);
    // #endregion references


    // #region state
    const [
        loading,
        setLoading,
    ] = useState(true);

    const [
        background,
        setBackground,
    ] = useState(false);

    const [
        leftSide,
        setLeftSide,
    ] = useState(true);

    const [
        width,
        setWidth,
    ] = useState(500);

    const [
        height,
        setHeight,
    ] = useState(550);
    // #endregion state


    // #region handlers
    const reset = () => {
        setBackground(false);
        setLeftSide(defaultOptions.left);
        setWidth(defaultOptions.width);
        setHeight(defaultOptions.height);
    }
    // #endregion handlers


    // #region effects
    useEffect(() => {
        const load = async () => {
            try {
                const data = await chrome.storage.local.get(OPTIONS_KEY);
                if (!data || !data[OPTIONS_KEY]) {
                    return;
                }

                const {
                    background,
                    left,
                    width,
                    height,
                } = data[OPTIONS_KEY] as Options;

                setBackground(background === 'black');
                setLeftSide(left);
                setWidth(width);
                setHeight(height);

                setLoading(false);
            } catch (error) {
                return;
            }
        }

        load();
    }, []);

    useEffect(() => {
        if (!mounted.current) {
            return;
        }

        const save = async () => {
            try {
                const options: Options = {
                    background: background ? 'black' : 'transparent',
                    left: leftSide,
                    width,
                    height,
                };

                await chrome.storage.local.set({
                    [OPTIONS_KEY]: options,
                });
            } catch (error) {
                return;
            }
        }

        save();
    }, [
        background,
        leftSide,
        width,
        height,
    ]);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
        }
    }, []);
    // #endregion effects


    // #region render
    if (loading) {
        return (
            <StyledPopup
                theme={dewiki}
            >
            </StyledPopup>
        );
    }

    return (
        <StyledPopup
            theme={dewiki}
        >
            <h1>
                YouTube Side
            </h1>

            <div>
                press alt/option (⌥) + S on a YouTube page to activate side positioning
            </div>

            <InputSwitch
                name="background [⌥ + B]"
                checked={background}
                atChange={() => {
                    setBackground(value => !value);
                }}
                theme={dewiki}
                style={{
                    ...inputStyle,
                }}
            />

            <InputSwitch
                name="left side"
                checked={leftSide}
                atChange={() => {
                    setLeftSide(value => !value);
                }}
                theme={dewiki}
                style={{
                    ...inputStyle,
                }}
            />

            <InputLine
                name="width"
                text={width + ''}
                atChange={(event) => {
                    const value = event.target.value;
                    const parsed = parseInt(value, 10);
                    if (isNaN(parsed)) {
                        return;
                    }

                    setWidth(parsed);
                }}
                theme={dewiki}
                textline={{
                    type: 'number',
                }}
                style={{
                    ...inputStyle,
                }}
            />

            <InputLine
                name="height"
                text={height + ''}
                atChange={(event) => {
                    const value = event.target.value;
                    const parsed = parseInt(value, 10);
                    if (isNaN(parsed)) {
                        return;
                    }

                    setHeight(parsed);
                }}
                theme={dewiki}
                textline={{
                    type: 'number',
                }}
                style={{
                    ...inputStyle,
                }}
            />

            <div>
                <LinkButton
                    text="reset"
                    atClick={() => {
                        reset();
                    }}
                    theme={dewiki}
                    style={{
                        marginTop: '2rem',
                    }}
                    inline={true}
                />
            </div>
        </StyledPopup>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Popup;
// #endregion exports
