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

// starts the group under the settings rows (the shortcut hint and the library link)
// with the same divider the sections use
export const StyledHint = styled.div`
    margin-top: 0.25rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.8rem;
    opacity: 0.8;
`;

/** The same thin line that starts each section, between groups at the top level. */
export const StyledDivider = styled.hr`
    width: 250px;
    margin: 0.25rem 0;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
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

// the UI kit's switch adds a 2.2rem top margin of its own; the grids space the rows instead
export const switchStyle = {
    width: '250px',
    marginTop: 0,
};
// #endregion module
