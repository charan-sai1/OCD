import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  FormControlLabel,
  Switch,
  Select,
  MenuItem,
  InputLabel,
  Slider,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import { advancedImageCache } from '../utils/advancedCache';
import { DeviceCapabilities } from '../utils/deviceCapabilities';

interface OptimizationSettingsProps {
  onSettingsChange?: (settings: OptimizationSettings) => void;
}

interface OptimizationSettings {
  autoOptimize: boolean;
  quality: 'low' | 'medium' | 'high';
  maxCacheSize: number; // in MB
  backgroundOptimization: boolean;
  deviceAdaptive: boolean;
  pagesToPreload: number; // Number of pages to preload ahead
  progressiveLoading: boolean; // Enable blur-to-sharp transitions
  aggressivePreloading: boolean; // Always preload max pages regardless of memory
}

const OptimizationSettings: React.FC<OptimizationSettingsProps> = ({ onSettingsChange }) => {
  const [settings, setSettings] = useState<OptimizationSettings>({
    autoOptimize: true,
    quality: 'medium',
    maxCacheSize: 100, // Default 100MB
    backgroundOptimization: true,
    deviceAdaptive: true,
    pagesToPreload: 3,
    progressiveLoading: true,
    aggressivePreloading: false
  });

  const [cacheStats, setCacheStats] = useState<{
    count: number;
    totalSize: number;
    hitRate: number;
  } | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const deviceProfile = DeviceCapabilities.detect();

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ocd-optimization-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings(parsed);
      } catch (error) {
        console.warn('Failed to parse saved optimization settings:', error);
      }
    }
  }, []);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('ocd-optimization-settings', JSON.stringify(settings));
    onSettingsChange?.(settings);

    // Update cache size
    advancedImageCache.setMaxCacheSize(settings.maxCacheSize);
  }, [settings, onSettingsChange]);

  // Load cache statistics
  const loadCacheStats = async () => {
    setIsLoadingStats(true);
    try {
      const stats = await advancedImageCache.getStats();
      setCacheStats({
        count: stats.count,
        totalSize: stats.totalSize,
        hitRate: stats.hitRate
      });
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    loadCacheStats();
  }, []);

  const handleQualityChange = (quality: 'low' | 'medium' | 'high') => {
    setSettings(prev => ({ ...prev, quality }));

    // If device adaptive is on, show recommendation
    if (settings.deviceAdaptive && quality !== deviceProfile.recommendedSettings.quality) {
      // Could show a toast or alert here
      console.log(`Note: Your device recommends ${deviceProfile.recommendedSettings.quality} quality`);
    }
  };

  const handleCacheSizeChange = (_: Event, value: number | number[]) => {
    const size = Array.isArray(value) ? value[0] : value;
    setSettings(prev => ({ ...prev, maxCacheSize: size }));
  };

  const clearCache = async () => {
    if (confirm('Are you sure you want to clear the image cache? This will remove all optimized thumbnails.')) {
      try {
        await advancedImageCache.clear();
        await loadCacheStats();
      } catch (error) {
        console.error('Failed to clear cache:', error);
      }
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Image Optimization Settings
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure how images are optimized for the best performance on your device.
      </Typography>

      {/* Device Info */}
      <Alert severity="info" sx={{ mb: 3 }}>
        <Typography variant="body2">
          <strong>Device detected:</strong> {deviceProfile.cpuCores} cores, {deviceProfile.memoryGB}GB RAM
          {deviceProfile.isMobile ? ' (Mobile)' : ' (Desktop)'}
        </Typography>
        <Typography variant="body2">
          <strong>Recommended:</strong> {deviceProfile.recommendedSettings.quality} quality, {deviceProfile.recommendedSettings.batchSize} concurrent operations
        </Typography>
      </Alert>

      {/* Auto Optimization */}
      <FormControlLabel
        control={
          <Switch
            checked={settings.autoOptimize}
            onChange={(e) => setSettings(prev => ({ ...prev, autoOptimize: e.target.checked }))}
          />
        }
        label="Automatically optimize new folders"
        sx={{ mb: 2, display: 'block' }}
      />

      {/* Device Adaptive */}
      <FormControlLabel
        control={
          <Switch
            checked={settings.deviceAdaptive}
            onChange={(e) => setSettings(prev => ({ ...prev, deviceAdaptive: e.target.checked }))}
          />
        }
        label="Use device-adaptive settings"
        sx={{ mb: 3, display: 'block' }}
      />

      {/* Quality Settings */}
      <FormControl fullWidth sx={{ mb: 3 }}>
        <InputLabel>Thumbnail Quality</InputLabel>
        <Select
          value={settings.quality}
          onChange={(e) => handleQualityChange(e.target.value as 'low' | 'medium' | 'high')}
          disabled={settings.deviceAdaptive}
        >
          <MenuItem value="low">
            <Box>
              <Typography variant="body2" fontWeight="medium">Fast (200px) - Best for mobile</Typography>
              <Typography variant="caption" color="text.secondary">Smaller file sizes, faster generation</Typography>
            </Box>
          </MenuItem>
          <MenuItem value="medium">
            <Box>
              <Typography variant="body2" fontWeight="medium">Balanced (300px) - Recommended</Typography>
              <Typography variant="caption" color="text.secondary">Good quality and performance balance</Typography>
            </Box>
          </MenuItem>
          <MenuItem value="high">
            <Box>
              <Typography variant="body2" fontWeight="medium">High Quality (400px) - Best for desktop</Typography>
              <Typography variant="caption" color="text.secondary">Best visual quality, slower generation</Typography>
            </Box>
          </MenuItem>
        </Select>
      </FormControl>

      {/* Cache Size */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" gutterBottom>
          Maximum Cache Size: {settings.maxCacheSize} MB
        </Typography>
        <Slider
          value={settings.maxCacheSize}
          onChange={handleCacheSizeChange}
          min={25}
          max={500}
          step={25}
          marks={[
            { value: 25, label: '25MB' },
            { value: 100, label: '100MB' },
            { value: 200, label: '200MB' },
            { value: 500, label: '500MB' },
          ]}
          valueLabelDisplay="auto"
        />
        <Typography variant="caption" color="text.secondary">
          Larger cache = faster loading, but uses more disk space
        </Typography>
      </Box>

      {/* Background Optimization */}
      <FormControlLabel
        control={
          <Switch
            checked={settings.backgroundOptimization}
            onChange={(e) => setSettings(prev => ({ ...prev, backgroundOptimization: e.target.checked }))}
          />
        }
        label="Allow background optimization"
        sx={{ mb: 2, display: 'block' }}
      />

      {/* Progressive Loading */}
      <FormControlLabel
        control={
          <Switch
            checked={settings.progressiveLoading}
            onChange={(e) => setSettings(prev => ({ ...prev, progressiveLoading: e.target.checked }))}
          />
        }
        label="Progressive loading (blur-to-sharp transitions)"
        sx={{ mb: 2, display: 'block' }}
      />

      {/* Pages to Preload */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" gutterBottom>
          Pages to preload ahead: {settings.pagesToPreload}
        </Typography>
        <Slider
          value={settings.pagesToPreload}
          onChange={(_, value) => setSettings(prev => ({ ...prev, pagesToPreload: value as number }))}
          min={1}
          max={5}
          step={1}
          marks={[
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 4, label: '4' },
            { value: 5, label: '5' },
          ]}
          valueLabelDisplay="auto"
        />
        <Typography variant="caption" color="text.secondary">
          More pages = smoother scrolling, higher memory usage
        </Typography>
      </Box>

      {/* Aggressive Preloading */}
      <FormControlLabel
        control={
          <Switch
            checked={settings.aggressivePreloading}
            onChange={(e) => setSettings(prev => ({ ...prev, aggressivePreloading: e.target.checked }))}
          />
        }
        label="Aggressive preloading (ignore memory limits)"
        sx={{ mb: 3, display: 'block' }}
      />

      {/* Cache Statistics */}
      <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
        <Typography variant="body2" fontWeight="medium" gutterBottom>
          Cache Statistics
        </Typography>
        {isLoadingStats ? (
          <CircularProgress size={20} />
        ) : cacheStats ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="caption">
              Thumbnails cached: {cacheStats.count}
            </Typography>
            <Typography variant="caption">
              Cache size: {formatFileSize(cacheStats.totalSize)}
            </Typography>
            <Typography variant="caption">
              Cache hit rate: {(cacheStats.hitRate * 100).toFixed(1)}%
            </Typography>
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Unable to load cache statistics
          </Typography>
        )}
      </Box>

      {/* Cache Management */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button
          variant="outlined"
          onClick={loadCacheStats}
          disabled={isLoadingStats}
        >
          Refresh Stats
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={clearCache}
        >
          Clear Cache
        </Button>
      </Box>
    </Box>
  );
};

export default OptimizationSettings;
export type { OptimizationSettings };