const REPO_URL = 'https://github.com/AnemoCode/Loopwise/';
const MAKER_URL = 'https://anemolabs.de';

const linkClass = 'font-medium text-accent-600 hover:underline dark:text-accent-300';

/** "Loopboard is open source" with a link to the repository, and the maker in the corner. */
export function RepoFooter() {
  return (
    <footer className="relative w-full px-4 py-6 text-center text-xs text-muted sm:px-6">
      <p>
        Loopboard is open source.{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={linkClass}>
          View it on GitHub
        </a>
      </p>
      <p className="mt-2 sm:absolute sm:right-6 sm:bottom-6 sm:mt-0">
        Made by{' '}
        <a href={MAKER_URL} target="_blank" rel="noreferrer" className={linkClass}>
          AnemoLabs
        </a>
      </p>
    </footer>
  );
}
