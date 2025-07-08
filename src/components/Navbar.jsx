export default function Navbar() {
  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center">
              <img src="https://placehold.co/40x40" alt="My OCD Organizer logo" className="h-8 w-8 rounded" />
              <span className="ml-2 text-xl font-bold">My OCD Tool</span>
            </div>
          </div>
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-8">
              <a href="#features" className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                Features
              </a>
              <a href="#how-it-works" className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                How It Works
              </a>
              <a href="#download" className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                Get It
              </a>
            </div>
          </div>
          <div className="md:ml-4">
            <a href="#download" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-green-500 hover:from-blue-700 hover:to-green-600 transition-all duration-300">
              Download My Tool
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
