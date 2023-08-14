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
    } from '@plurid/plurid-ui-components-react';
    // #endregion libraries


    // #region external
    import {
        Options,
    } from '~data/interfaces';

    import {
        OPTIONS_KEY,
    } from '~data/constants';
    // #endregion external


    // #region internal
    import {
        StyledPopup,
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
        active,
        setActive,
    ] = useState(false);

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


    // #region effects
    useEffect(() => {
        const getActiveTab = async () => {
            try {
                const activeTab = await chrome.tabs.query({
                    active: true,
                });
            } catch (error) {
                return;
            }
        }

        getActiveTab();
    }, []);

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

        // send message to tab
    }, [
        active,
    ]);

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
                name="active"
                checked={active}
                atChange={() => {
                    setActive(value => !value);
                }}
                theme={dewiki}
                style={{
                    width: '200px',
                }}
            />

            <InputSwitch
                name="background"
                checked={background}
                atChange={() => {
                    setBackground(value => !value);
                }}
                theme={dewiki}
                style={{
                    width: '200px',
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
                    width: '200px',
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
                    width: '200px',
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
                    width: '200px',
                }}
            />
        </StyledPopup>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default Popup;
// #endregion exports
