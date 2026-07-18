const isNode = typeof window === 'undefined';

/**
 * @typedef {{
 * 	getItem: (key: string) => string | null,
 * 	setItem: (key: string, value: string) => void,
 * 	removeItem: (key: string) => void
 * }} AppStorage
 */

const createMemoryStorage = () => {
	const values = new Map();
	return {
		getItem: (key) => values.has(key) ? values.get(key) : null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: (key) => values.delete(key),
	};
}

/** @type {AppStorage} */
const storage = isNode ? createMemoryStorage() : window.localStorage;

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
	if (isNode) {
		return defaultValue;
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(paramName);
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
			}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		storage.setItem(storageKey, searchParam);
		return searchParam;
	}
	if (defaultValue) {
		storage.setItem(storageKey, defaultValue);
		return defaultValue;
	}
	const storedValue = storage.getItem(storageKey);
	if (storedValue) {
		return storedValue;
	}
	return null;
}

const getAppParams = () => {
	if (getAppParamValue("clear_access_token") === 'true') {
		storage.removeItem('base44_access_token');
		storage.removeItem('token');
	}

	// If access_token is in the URL, store it and do a hard reload so the SDK
	// re-initializes with the token. This prevents the loop where the client
	// is created with token=null and can't authenticate even after login.
	if (!isNode) {
		const urlParams = new URLSearchParams(window.location.search);
		const accessToken = urlParams.get('access_token');
		if (accessToken) {
			storage.setItem('base44_access_token', accessToken);
			urlParams.delete('access_token');
			const cleanUrl = window.location.pathname + (urlParams.toString() ? `?${urlParams.toString()}` : '');
			window.location.replace(cleanUrl);
			// Return a placeholder — the page is about to reload
			return { appId: null, token: accessToken, fromUrl: '/', functionsVersion: null, appBaseUrl: null };
		}
	}

	return {
		appId: getAppParamValue("app_id", { defaultValue: import.meta.env.VITE_BASE44_APP_ID }),
		token: getAppParamValue("access_token", { removeFromUrl: true }),
		fromUrl: getAppParamValue("from_url", { defaultValue: window.location.origin + '/' }),
		functionsVersion: getAppParamValue("functions_version", { defaultValue: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION }),
		appBaseUrl: getAppParamValue("app_base_url", { defaultValue: import.meta.env.VITE_BASE44_APP_BASE_URL }),
	}
}


export const appParams = {
	...getAppParams()
}
