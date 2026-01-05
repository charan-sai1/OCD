import React, { useState, useEffect } from "react";
import {
  Box,
  TextField,
  InputAdornment,
  IconButton,
  Paper,
} from "@mui/material";
import { Search as SearchIcon, Clear as ClearIcon } from "@mui/icons-material";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  sidebarWidth: number;
  isVisible?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  placeholder = "Search photos...",
  sidebarWidth,
  isVisible = true,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [contentCenter, setContentCenter] = useState(0);

  useEffect(() => {
    const updateCenter = () => {
      const totalWidth = window.innerWidth;
      const contentWidth = totalWidth - sidebarWidth;
      const center = sidebarWidth + contentWidth / 2;
      setContentCenter(center);
    };

    updateCenter();
    window.addEventListener("resize", updateCenter);
    return () => window.removeEventListener("resize", updateCenter);
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

  if (!isVisible) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 24,
        left: contentCenter,
        zIndex: 1000,
        width: "100%",
        maxWidth: 600,
        px: 3,
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: isVisible ? 1 : 0,
        transform: isVisible
          ? `translateX(-50%)`
          : `translateX(-50%) translateY(20px) scale(0.95)`,
        pointerEvents: isVisible ? "auto" : "none",
      }}
    >
      <Paper
        elevation={4}
        sx={{
          borderRadius: 3,
          backgroundColor: "background.paper",
          backdropFilter: "blur(10px)",
        }}
      >
        <TextField
          fullWidth
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={placeholder}
          variant="outlined"
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 3,
              "& fieldset": {
                borderColor: "divider",
              },
              "&:hover fieldset": {
                borderColor: "text.secondary",
              },
              "&.Mui-focused fieldset": {
                borderColor: "primary.main",
              },
            },
            "& .MuiOutlinedInput-input": {
              padding: "12px 14px",
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: "text.secondary" }} />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={handleClearSearch}
                  sx={{
                    color: "text.secondary",
                    "&:hover": {
                      color: "text.primary",
                    },
                  }}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Paper>
    </Box>
  );
};

export default SearchBar;
