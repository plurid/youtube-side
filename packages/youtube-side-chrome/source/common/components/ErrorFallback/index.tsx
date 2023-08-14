// #region imports
    // #region libraries
    import React from 'react';
    // #endregion libraries
// #region imports



// #region module
export interface ErrorFallbackProperties {
    errorCode?: string;
}

const ErrorFallback: React.FC<ErrorFallbackProperties> = (
    properties,
) => {
    // #region properties
    const {
        errorCode,
    } = properties;
    // #endregion properties


    // #region render
    return (
        <div
            style={{
                width: '100%',
                display: 'grid',
                placeContent: 'center',
                textAlign: 'center',
                gap: '2rem',
            }}
        >
            <div>
                something went very wrong {errorCode ? `(${errorCode})` : ''}
            </div>

            <div>
                reinstall the extension
            </div>
        </div>
    );
    // #endregion render
}
// #endregion module



// #region exports
export default ErrorFallback;
// #endregion exports
