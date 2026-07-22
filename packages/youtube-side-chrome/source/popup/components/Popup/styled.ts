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

export const StyledOptionRow = styled.div`
    box-sizing: border-box;
    width: 250px;
    padding-left: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.9rem;
    margin-top: 1rem;
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
