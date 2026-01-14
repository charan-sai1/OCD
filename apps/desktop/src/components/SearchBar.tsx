import React, { useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import CircularProgress from "@mui/material/CircularProgress";
import { Clear as ClearIcon, AutoAwesome as AiIcon } from "@mui/icons-material";

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
          elevation={12}
          sx={{
            borderRadius: 50,
            background: `
              linear-gradient(135deg,
                rgba(255,255,255,0.25) 0%,
                rgba(255,255,255,0.15) 25%,
                rgba(255,255,255,0.08) 50%,
                rgba(255,255,255,0.15) 75%,
                rgba(255,255,255,0.25) 100%
              )
            `,
            backdropFilter: "blur(24px) saturate(180%)",
            boxShadow: `
              0 8px 32px rgba(0, 0, 0, 0.08),
              0 2px 8px rgba(255, 255, 255, 0.1) inset,
              0 0 40px rgba(255, 255, 255, 0.05)
            `,
            border: "1px solid rgba(255, 255, 255, 0.3)",
            position: "relative",
            overflow: "hidden",
            "&::before": {
              content: '""',
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: `
                radial-gradient(circle at 20% 20%, rgba(255,255,255,0.1) 0%, transparent 50%),
                radial-gradient(circle at 80% 80%, rgba(255,255,255,0.08) 0%, transparent 50%)
              `,
              animation: "aiGlow 4s ease-in-out infinite alternate",
              pointerEvents: "none",
            },
            "@keyframes aiGlow": {
              "0%": {
                opacity: 0.3,
                transform: "scale(1)",
              },
              "100%": {
                opacity: 0.7,
                transform: "scale(1.02)",
              },
            },
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
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  backgroundColor: "transparent",
                  "& fieldset": {
                    border: "none",
                  },
                  "&:hover": {
                    transform: "translateY(-1px)",
                    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.1)",
                  },
                  "&.Mui-focused": {
                    transform: "translateY(-1px)",
                    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.1), 0 0 0 3px rgba(66, 133, 244, 0.3)",
                  },
                },
             "& .MuiOutlinedInput-input": {
               padding: "14px 16px",
               color: "#000000",
               fontWeight: 500,
               letterSpacing: "0.01em",
               "&::placeholder": {
                 color: "rgba(0, 0, 0, 0.6)",
                 opacity: 1,
                 fontWeight: 400,
               },
             },
           }}
             InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      position: "relative",
                    }}
                  >
                    <AiIcon
                      sx={{
                        color: searchQuery ? "#4285F4" : "rgba(0, 0, 0, 0.7)",
                        fontSize: 20,
                        transition: "all 0.3s ease",
                        filter: searchQuery ? "drop-shadow(0 0 8px rgba(66, 133, 244, 0.4))" : "none",
                        animation: searchQuery ? "aiPulse 2s ease-in-out infinite" : "none",
                        "@keyframes aiPulse": {
                          "0%, 100%": {
                            transform: "scale(1)",
                            filter: "drop-shadow(0 0 8px rgba(66, 133, 244, 0.4))",
                          },
                          "50%": {
                            transform: "scale(1.1)",
                            filter: "drop-shadow(0 0 12px rgba(66, 133, 244, 0.6))",
                          },
                        },
                      }}
                    />
                    {searchQuery && (
                      <Box
                        sx={{
                          position: "absolute",
                          top: -2,
                          right: -2,
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "linear-gradient(45deg, #4285F4, #34A853)",
                          boxShadow: "0 0 10px rgba(66, 133, 244, 0.6)",
                          animation: "aiSparkle 1.5s ease-in-out infinite",
                          "@keyframes aiSparkle": {
                            "0%, 100%": {
                              opacity: 1,
                              transform: "scale(1)",
                            },
                            "50%": {
                              opacity: 0.7,
                              transform: "scale(1.2)",
                            },
                          },
                        }}
                      />
                    )}
                  </Box>
                </InputAdornment>
              ),
            endAdornment: (
              <InputAdornment position="end">
                {isSearching && (
                  <Box sx={{ position: "relative", mr: 1 }}>
                    <CircularProgress
                      size={20}
                      sx={{
                        color: "#4285F4",
                        filter: "drop-shadow(0 0 6px rgba(66, 133, 244, 0.4))",
                      }}
                    />
                    <Box
                      sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: "#4285F4",
                        animation: "aiThinking 1.2s ease-in-out infinite",
                        "@keyframes aiThinking": {
                          "0%, 100%": { opacity: 0.3 },
                          "50%": { opacity: 1 },
                        },
                      }}
                    />
                  </Box>
                )}
                {searchQuery && (
                  <IconButton
                    size="small"
                    onClick={handleClearSearch}
                    sx={{
                      color: "rgba(0, 0, 0, 0.7)",
                      transition: "all 0.2s ease",
                      "&:hover": {
                        color: "#000000",
                        transform: "scale(1.1)",
                        backgroundColor: "rgba(0, 0, 0, 0.05)",
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
