// #region imports
// #region libraries
import styled from 'styled-components';
// #endregion libraries
// #endregion imports

// #region module
export const StyledPopup = styled.div`
    h1 {
        font-size: 14px;
        font-weight: 400;
        margin-bottom: 2rem;
    }

    a {
        color: white;
        text-decoration: none;
    }

    display: grid;
    place-content: center;
    justify-items: center;
    padding: 2rem;
    grid-gap: 1rem;
    line-height: 1.5;
`;

export const StyledNotice = styled.div`
    font-size: 0.85rem;
    color: #ffb74d;
    text-align: center;
`;

export const StyledSection = styled.div`
    width: 250px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 1rem;
    margin-top: 0.5rem;
    display: grid;
    grid-gap: 0.75rem;

    h2 {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.7;
        margin: 0;
    }
`;

export const StyledOptionRow = styled.div`
    box-sizing: border-box;
    width: 250px;
    padding-left: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.9rem;
`;

export const StyledSliders = styled.div`
    box-sizing: border-box;
    width: 250px;
    padding-left: 12px;
    display: grid;
    grid-gap: 1rem;
`;

export const inputStyle = {
    width: '250px',
};
// #endregion module
