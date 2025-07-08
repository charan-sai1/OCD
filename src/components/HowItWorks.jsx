const features = [
  {
    icon: '📁',
    title: "Smart Sorting",
    description: "Files go where they belong. No arguments. Photos by date, documents by type - simple."
  },
  {
    icon: '🔍',
    title: "Duplicate Smasher",
    description: "Eliminates copies because storage is cheap but my patience isn't."
  },
  {
    icon: '👀',
    title: "Preview Mode",
    description: "See what's going to happen before it does. I'm not reckless."
  },
  {
    icon: '↩️',
    title: "One-Click Revert",
    description: "Mistakes happen. Even to me. So there's a rollback option."
  },
  {
    icon: '🚫',
    title: "Filters",
    description: "Because some files just aren't worthy of being organized my way."
  },
  {
    icon: '⚡',
    title: "Batch Mode",
    description: "Got multiple messes? Fix them all at once. I don't have all day."
  }
];

export default function Features() {
  return (
    <div id="features" className="py-12 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="lg:text-center">
          <h2 className="text-base text-blue-600 font-semibold tracking-wide uppercase">What it does</h2>
          <p className="mt-2 text-3xl leading-8 font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            Features I actually use
          </p>
          <p className="mt-4 max-w-2xl text-xl text-gray-500 lg:mx-auto">
            No bloat, just the things that help me keep my files in order.
          </p>
        </div>

        <div className="mt-10">
          <div className="grid grid-cols-1 gap-y-10 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <div key={index} className="group relative bg-white p-6 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 rounded-lg shadow hover:shadow-lg transition-all duration-300">
                <div className="rounded-lg inline-flex p-3 text-2xl">
                  {feature.icon}
                </div>
                <div className="mt-8">
                  <h3 className="text-lg font-medium">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
