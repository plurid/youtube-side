// #region imports
// #region libraries
import React from 'react';
// #endregion libraries

// #region external
import { log } from '~common/utilities';
// #endregion external
// #endregion imports

// #region module
export interface ErrorBoundaryProperties {
    fallback: React.ReactNode;
    children: React.ReactNode;
}

export interface ErrorBoundaryState {
    hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProperties, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProperties) {
        super(props);
        this.state = {
            hasError: false,
        };
    }

    static getDerivedStateFromError(_error: unknown): ErrorBoundaryState {
        return {
            hasError: true,
        };
    }

    override componentDidCatch(error: Error, info: React.ErrorInfo) {
        log(error, info);
    }

    override render() {
        if (this.state.hasError) {
            return this.props.fallback;
        }

        return this.props.children;
    }
}
// #endregion module

// #region exports
export default ErrorBoundary;
// #endregion exports
