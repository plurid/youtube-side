import styled from 'styled-components';

const surface = '#181818';
const line = 'rgba(255, 255, 255, 0.1)';
const muted = '#aaa';
const accent = '#3ea6ff';
const brand = '#ff0000';

export const StyledLibrary = styled.main`
    box-sizing: border-box;
    max-width: 920px;
    margin: 0 auto;
    padding: 40px 24px 80px;

    a {
        color: ${accent};
        text-decoration: none;
    }

    a:hover {
        text-decoration: underline;
    }

    button:focus-visible,
    a:focus-visible,
    input:focus-visible {
        outline: 2px solid ${accent};
        outline-offset: 2px;
    }
`;

export const StyledHeader = styled.header`
    display: grid;
    gap: 16px;
    margin-bottom: 24px;

    h1 {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        font-size: 24px;
        font-weight: 400;
    }

    h1::before {
        content: '';
        width: 10px;
        height: 24px;
        border-radius: 2px;
        background: ${brand};
    }
`;

export const StyledMeta = styled.div`
    color: ${muted};
    font-size: 13px;
`;

export const StyledToolbar = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
`;

export const StyledSearch = styled.input`
    flex: 1 1 260px;
    min-width: 0;
    box-sizing: border-box;
    padding: 9px 14px;
    border: 1px solid ${line};
    border-radius: 20px;
    background: #121212;
    color: inherit;
    font: inherit;
`;

export const StyledButton = styled.button<{ $danger?: boolean }>`
    padding: 7px 14px;
    border: 1px solid ${line};
    border-radius: 18px;
    background: ${({ $danger }) => ($danger ? 'rgba(255, 82, 82, 0.16)' : 'rgba(255, 255, 255, 0.06)')};
    color: ${({ $danger }) => ($danger ? '#ff8a80' : 'inherit')};
    font: inherit;
    font-size: 13px;
    cursor: pointer;

    &:hover:not(:disabled) {
        background: ${({ $danger }) => ($danger ? 'rgba(255, 82, 82, 0.26)' : 'rgba(255, 255, 255, 0.12)')};
    }

    &:disabled {
        opacity: 0.45;
        cursor: default;
    }
`;

export const StyledStatus = styled.div`
    min-height: 20px;
    color: ${muted};
    font-size: 13px;
`;

export const StyledList = styled.ul`
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
`;

export const StyledCard = styled.li`
    display: grid;
    gap: 8px;
    padding: 16px 18px;
    border: 1px solid ${line};
    border-radius: 12px;
    background: ${surface};

    h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
        overflow-wrap: anywhere;
    }

    h2 a {
        color: inherit;
    }
`;

export const StyledCardActions = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
`;

export const StyledNote = styled.p<{ $collapsed: boolean }>`
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: #ddd;
    font-size: 14px;
    ${({ $collapsed }) =>
        $collapsed
            ? `
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    `
            : ''}
`;

export const StyledBookmarks = styled.ol`
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 14px;

    li {
        display: flex;
        gap: 10px;
    }

    a {
        flex-shrink: 0;
        font-family: monospace;
    }
`;

export const StyledEmpty = styled.div`
    padding: 48px 24px;
    border: 1px dashed ${line};
    border-radius: 12px;
    color: ${muted};
    text-align: center;
`;
