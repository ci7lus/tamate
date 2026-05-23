import { AnnictApiError } from "./annict";

export const getErrorMessage = (error: unknown) => {
	if (error instanceof AnnictApiError || error instanceof Error) {
		return error.message;
	}

	return "不明なエラーが発生しました。";
};

export const isUnauthorizedError = (error: unknown) => {
	if (error instanceof AnnictApiError) {
		return error.status === 401;
	}

	if (error instanceof Error) {
		return /not authorized/i.test(error.message);
	}

	return false;
};
