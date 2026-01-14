import React, { useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import CircularProgress from "@mui/material/CircularProgress";
import { Search as SearchIcon, Clear as ClearIcon } from "@mui/icons-material";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  sidebarWidth: number;
  isVisible?: boolean;
  resultCount?: number;
  isSearching?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  placeholder = "Search photos...",
  sidebarWidth,
  isVisible = true,
  resultCount,
  isSearching = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [contentCenter, setContentCenter] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateLayout = () => {
      const totalWidth = window.innerWidth;
      const contentWidth = totalWidth - sidebarWidth;
      const center = sidebarWidth + contentWidth / 2;
      setContentCenter(center);
      setIsMobile(totalWidth < 768);
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, [sidebarWidth]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const query = event.target.value;
    setSearchQuery(query);
    onSearch(query);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    onSearch("");
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'f') {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === 'Escape' && searchQuery) {
        handleClearSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery]);

  if (!isVisible) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: isMobile ? 16 : 24,
        left: contentCenter,
        zIndex: 1000,
        width: "100%",
        maxWidth: "min(600px, calc(100vw - 32px))",
        px: 3,
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: isVisible ? 1 : 0.8,
        transform: isVisible
          ? `translateX(-50%)`
          : `translateX(-50%) translateY(calc(100vh + 100px))`,
        pointerEvents: isVisible ? "auto" : "none",
      }}
    >
      {resultCount !== undefined && searchQuery && (
        <Box
          sx={{
            position: "absolute",
            top: -12,
            right: 24,
            backgroundColor: "primary.main",
            color: "primary.contrastText",
            borderRadius: 2,
            px: 1,
            py: 0.5,
            fontSize: "0.75rem",
            fontWeight: 500,
            minWidth: 20,
            textAlign: "center",
            boxShadow: 2,
            zIndex: 1001,
          }}
        >
          {resultCount}
        </Box>
      )}
        <Paper
          elevation={8}
          sx={{
            borderRadius: 50,
            backgroundColor: "rgba(255, 255, 255, 0.15)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            background: "linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.1) 100%)",
          }}
        >
        <TextField
          fullWidth
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={placeholder}
          variant="outlined"
          aria-label="Search photos"
          role="searchbox"
          inputRef={inputRef}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: 50,
                  transition: "all 0.2s ease-in-out",
                  backgroundColor: "transparent",
                  "& fieldset": {
                    border: "none",
                  },
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                  "&.Mui-focused": {
                    backgroundColor: "rgba(255, 255, 255, 0.15)",
                    boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.3)",
                  },
                },
             "& .MuiOutlinedInput-input": {
               padding: "12px 14px",
               color: "#000000",
               "&::placeholder": {
                 color: "rgba(0, 0, 0, 0.6)",
                 opacity: 1,
               },
             },
           }}
             InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: "rgba(0, 0, 0, 0.7)" }} />
                </InputAdornment>
              ),
            endAdornment: (
              <InputAdornment position="end">
                {isSearching && (
                  <CircularProgress
                    size={20}
                    sx={{ color: "rgba(0, 0, 0, 0.7)", mr: 1 }}
                  />
                )}
                {searchQuery && (
                  <IconButton
                    size="small"
                    onClick={handleClearSearch}
                    sx={{
                      color: "rgba(0, 0, 0, 0.7)",
                      "&:hover": {
                        color: "#000000",
                      },
                    }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                )}
              </InputAdornment>
            ),
          }}
        />
      </Paper>
    </Box>
  );
};

export default SearchBar;
