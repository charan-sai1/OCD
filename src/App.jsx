import React, { useState, useEffect, createContext, useContext } from 'react';
import { Sun, Moon, Download, Github, Linkedin, FolderOpen, Zap, Shield, Cpu,Calendar,FileText,Filter ,Copy ,Settings,HelpCircle   } from 'lucide-react';
import Bg from '../public/bg.png'
import Logo from '../public/OCD.png'
import Lenis from '@studio-freight/lenis';
// Theme Context
const ThemeContext = createContext();

const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Navigation Component
const Navigation = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="fixed w-full z-20 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-sm border-b border-gray-100 dark:border-gray-800">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <div className="flex items-center gap-5 text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          <img src={Logo} alt="" srcSet="" className='w-11 h-11'/>
          OCD
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200"
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          
        </div>
      </div>
    </nav>
  );
};

// Hero Section Component
const HeroSection = () => {
  return (
    <section className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 pt-20">
  <img src={Bg} alt="Background" className='mix-blend-color-burn dark:mix-blend-screen opacity-10 absolute object-cover'/>

      <div className=" mx-auto px-4 z-1 ">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center min-h-screen px-20">
          {/* Left Column - Content */}
          <div className="space-y-8 relative">
            <div className="inline-flex items-center space-x-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-4 py-2 rounded-full text-sm font-medium">
              <FolderOpen size={16} />
              <span>File Management Simplified</span>
            </div>
            
            <h1 className="text-6xl lg:text-7xl font-extrabold leading-none tracking-tight">
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                IT'S FOR ME,
              </span>
              <br />
              <span className="text-gray-900 dark:text-white">
                NOT FOR YOU
              </span>
            </h1>
            
            <p className="text-xl text-gray-600 dark:text-gray-300 leading-relaxed ">
              I always wanted an app that clearly organizes my files without any AI and internet being involved. 
              Completely local, completely free, and super fast and smooth. 
              <span className="font-semibold text-blue-600 dark:text-blue-400"> I didn't make this for you; I made it for me and my satisfaction.</span>
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="OCD.zip"
                download
                className="inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-2xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/40 transform hover:scale-105 transition-all duration-300 group"
              >
                <Download size={24} className="mr-3 group-hover:animate-bounce"
                download="OCD.zip" />
                Download OCD
              </a>
              
              <button className="inline-flex items-center justify-center px-8 py-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-semibold rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 hover:shadow-xl transition-all duration-300">
                
                Learn More
              </button>
            </div>
            
            
          </div>
          
          {/* Right Column - Hero Visual */}
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-3xl blur-3xl opacity-20 animate-pulse"></div>
            <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 border border-gray-200 dark:border-gray-700">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">OCD File Organizer</div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-center space-x-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                    <FolderOpen className="text-blue-600 dark:text-blue-400" size={20} />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Documents</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">1,234 files organized</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl">
                    <Shield className="text-purple-600 dark:text-purple-400" size={20} />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Privacy First</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">No internet, no AI</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
                    <Zap className="text-green-600 dark:text-green-400" size={20} />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Lightning Fast</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Instant file sorting</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
        {/* Stats */}
            <div className="grid grid-cols-3 gap-8 p-8 pb-30 pt-0 relative">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">100%</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Local</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">Free</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Forever</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">Fast</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">& Smooth</div>
              </div>
            </div>
    </section>
  );
};

// Features Section
const FeaturesSection = () => {
  const features = [
    {
      icon: <Shield className="text-blue-600 dark:text-blue-400" size={32} />,
      title: "100% Private",
      description: "Your files stay on your device. No cloud, no AI, no internet required."
    },
    {
      icon: <Zap className="text-purple-600 dark:text-purple-400" size={32} />,
      title: "Lightning Fast",
      description: "Instant file organization with smooth, responsive interface."
    },
    {
      icon: <Cpu className="text-green-600 dark:text-green-400" size={32} />,
      title: "Lightweight",
      description: "Minimal resource usage. Won't slow down your computer."
    }
  ];

  return (
    <section className="py-24 bg-white dark:bg-gray-900">
      <div className="container mx-auto px-4 ">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Why Choose <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">OCD</span>?
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Built with a focus on privacy, performance, and simplicity. No compromises.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div key={index} className="text-center p-8 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 rounded-2xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-white dark:bg-gray-900 rounded-2xl shadow-lg mb-6">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{feature.title}</h3>
              <p className="text-gray-600 dark:text-gray-300">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// GitHub Section Component
const GitHubSection = () => {
  return (
    <section className="py-24 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4  text-center">
        <div className="bg-white dark:bg-gray-800 rounded-3xl p-12 shadow-2xl">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Open Source & Community Driven
          </h2>
          
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
            This project is open-source and built with passion. Your contributions can make it even better! 
            Feel free to explore the codebase, report issues, or suggest new features.
          </p>
          
          <a
            href="https://github.com/charan-sai1/OCD/tree/master"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-8 py-4 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 group transform hover:scale-105"
          >
            <Github size={24} className="mr-3 group-hover:rotate-12 transition-transform" />
            View on GitHub & Star
          </a>
        </div>
      </div>
    </section>
  );
};

// LinkedIn Section Component
const LinkedInSection = () => {
  return (
    <section className="py-24 bg-white dark:bg-gray-900">
      <div className="container mx-auto px-4 max-w-4xl text-center">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-3xl p-12 text-white shadow-2xl">
          <h2 className="text-4xl lg:text-5xl font-bold mb-6">
            Let's Connect & Build Together
          </h2>
          
          <p className="text-xl mb-8 leading-relaxed opacity-90">
            I'm always looking for exciting opportunities to collaborate and grow. 
            Let's connect and explore how we can build amazing things together!
          </p>
          
          <a
            href="https://www.linkedin.com/in/sai-charan782973/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-8 py-4 bg-white text-blue-600 font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 group transform hover:scale-105"
          >
            <Linkedin size={24} className="mr-3 group-hover:scale-110 transition-transform" />
            Connect on LinkedIn
          </a>
        </div>
      </div>
    </section>
  );
};

const FAQSection = () => {
  const [openFAQ, setOpenFAQ] = useState(null);

  const faqs = [
    {
      question: "Why is the application not moving my files?",
      answer: "Check the Log section for detailed messages. Ensure you've selected both source and destination folders. If you ran Preview, remember it only simulates - click 'Organize Files' for actual operation. Files might be skipped due to filters, permissions, or exclusion rules."
    },
    {
      question: "My files are not being organized by date/type as expected.",
      answer: "Double-check your Organization Method selection. For date-based organization, files need valid creation dates. For Smart Organize, ensure media files have common extensions (.jpg, .png, .mp4, .avi, etc.)."
    },
    {
      question: "How does duplicate handling work?",
      answer: "The app calculates MD5 hash for each file. Files with identical hashes are duplicates. You can Skip (leave in place), Move to subfolder (create Duplicates folder), or Delete permanently (use with caution!)."
    },
    {
      question: "Can I undo an organization operation?",
      answer: "Yes! Immediately after organizing, click the Revert button to move files back to original locations. Note: This only works for moved files, not deleted duplicates. Closing the app clears revert history."
    },
    {
      question: "The app shows 'Permission denied' errors.",
      answer: "Run the application as administrator or check folder permissions. Ensure your user account has full read/write access to both source and destination directories."
    },
    {
      question: "How do I export the log messages?",
      answer: "Click the 'Export Log' button to save all log messages to a .txt file. Choose your preferred location and filename in the dialog that appears."
    },
    {
      question: "My settings are not saving/loading.",
      answer: "Settings are saved to 'file_organizer_settings.json' in the app directory. Ensure the app has write permissions. If the file is corrupted, delete it to reset (you'll lose saved settings)."
    },
    {
      question: "The app seems to freeze during large operations.",
      answer: "The app uses threading to stay responsive. Check your system's resource usage (CPU, Disk I/O). The progress bar should still update. For very large operations, it may appear slow but should continue processing."
    }
  ];

  return (
    <section className="py-24 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Frequently Asked <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Questions</span>
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Find answers to common questions and troubleshooting tips.
          </p>
        </div>
        
        <div className="max-w-4xl mx-auto space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setOpenFAQ(openFAQ === index ? null : index)}
                className="w-full px-8 py-6 text-left flex justify-between items-center bg-white dark:bg-gray-800 transition-colors duration-200"
              >
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white pr-4">
                  {faq.question}
                </h3>
                <div className={`transform transition-transform duration-200 ${openFAQ === index ? 'rotate-180' : ''}`}>
                  <HelpCircle className="text-blue-600 dark:text-blue-400" size={24} />
                </div>
              </button>
              {openFAQ === index && (
                <div className="px-8 pb-6 text-gray-600 dark:text-gray-300 leading-relaxed">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// How to Use Section
const HowToUseSection = () => {
  const steps = [
    {
      number: "01",
      title: "Launch & Setup",
      description: "Open the OCD File Organizer and select your source folders containing files to organize."
    },
    {
      number: "02",
      title: "Choose Destination",
      description: "Browse and select the destination folder where you want your organized files to be placed."
    },
    {
      number: "03",
      title: "Select Organization Method",
      description: "Choose from Smart Organize, By Year, By Year-Month, By Year-Month-Date, By Year-Week, or By File Type."
    },
    {
      number: "04",
      title: "Configure Filters",
      description: "Set optional filters like excluded extensions, name patterns, or file size ranges."
    },
    {
      number: "05",
      title: "Handle Duplicates",
      description: "Choose how to handle duplicate files: Skip, Move to subfolder, or Delete permanently."
    },
    {
      number: "06",
      title: "Preview & Organize",
      description: "Use Preview to see what will happen, then click Organize Files to execute the operation."
    }
  ];

  return (
    <section className="py-24 bg-white dark:bg-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            How to <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Use OCD</span>
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Get started with OCD File Organizer in just a few simple steps.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <div key={index} className="relative">
              <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2">
                <div className="text-6xl font-bold text-blue-600/20 dark:text-blue-400/20 mb-4">
                  {step.number}
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  {step.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                  {step.description}
                </p>
              </div>
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -right-4 w-8 h-px bg-gradient-to-r from-blue-600 to-purple-600 transform -translate-y-1/2"></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// Core Functionalities Section
const CoreFunctionalitiesSection = () => {
  const functionalities = [
    {
      icon: <FolderOpen className="text-blue-600 dark:text-blue-400" size={32} />,
      title: "Multi-Source Organization",
      description: "Select multiple source folders and organize them into a single destination with various methods."
    },
    {
      icon: <Calendar className="text-purple-600 dark:text-purple-400" size={32} />,
      title: "Smart Date Organization",
      description: "Organize files by Year, Year-Month, Year-Month-Date, or Year-Week based on creation dates."
    },
    {
      icon: <FileText className="text-green-600 dark:text-green-400" size={32} />,
      title: "File Type Sorting",
      description: "Group files by extension or use Smart Organize for media files with date-based sorting."
    },
    {
      icon: <Filter className="text-orange-600 dark:text-orange-400" size={32} />,
      title: "Advanced Filtering",
      description: "Exclude specific extensions, filter by file names, or set size ranges in MB."
    },
    {
      icon: <Copy className="text-red-600 dark:text-red-400" size={32} />,
      title: "Duplicate Handling",
      description: "Skip, move to subfolder, or permanently delete duplicate files using MD5 hashing."
    },
    {
      icon: <Settings className="text-indigo-600 dark:text-indigo-400" size={32} />,
      title: "Preview & Revert",
      description: "Preview operations before execution and revert the last organization if needed."
    }
  ];

  return (
    <section className="py-24 bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 dark:text-white mb-6">
            Core <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Functionalities</span>
          </h2>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
            Comprehensive file organization tools designed for efficiency and control.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {functionalities.map((functionality, index) => (
            <div key={index} className="p-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2 border border-gray-100 dark:border-gray-700">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600 rounded-2xl shadow-sm mb-6">
                {functionality.icon}
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{functionality.title}</h3>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed">{functionality.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};


// Footer Component
const Footer = () => {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="py-12 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      <div className="container mx-auto px-4 text-center">
        <div className="mb-6">
          <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            OCD
          </div>
          <p className="text-gray-600 dark:text-gray-400">Effortless File Management. Simplified.</p>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          &copy; {currentYear} OCD. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

// Main App Component
const App = () => {
    useEffect(() => {
    // Initialize Lenis
    const lenis = new Lenis({
      duration: 1.2,     // How long the scroll takes (seconds)
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // A common smooth easing function
      direction: 'vertical',
      gestureDirection: 'vertical',
      smooth: true,
      mouseMultiplier: 1,
      smoothTouch: true, // Set to true if you want smooth scroll on touch devices (can be resource intensive)
      touchMultiplier: 2,
      infinite: false,
    });

    // Request animation frame loop to update Lenis
    // This connects Lenis to the browser's animation loop
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    // Clean up Lenis instance when the component unmounts
    return () => {
      lenis.destroy();
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-white dark:bg-gray-900 transition-colors duration-300">
        <Navigation />
        <HeroSection />
        <FeaturesSection />
        <CoreFunctionalitiesSection></CoreFunctionalitiesSection>
        <HowToUseSection></HowToUseSection>
        <FAQSection></FAQSection>
        <GitHubSection />
        <LinkedInSection />
        <Footer />
      </div>
    </ThemeProvider>
  );
};

export default App;